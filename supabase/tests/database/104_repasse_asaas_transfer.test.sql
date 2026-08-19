begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(18);

select ok(
  not has_function_privilege('authenticated', 'public.listar_repasses_prontos(integer)', 'execute')
  and has_function_privilege('service_role', 'public.listar_repasses_prontos(integer)', 'execute'),
  'só o backend confiável reserva repasses da fila'
);
select ok(
  not has_function_privilege('authenticated', 'public.vincular_transferencia_gateway(uuid,text,text)', 'execute'),
  'Data API não vincula transferência ao gateway'
);

-- ===========================================================================
-- Fixture: mesma sequência de cobrança real de 102_repasse_automatico
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) values
('e0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cliente-transfer@teste.local','',now(),now()),
('e0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pro-transfer@teste.local','',now(),now());

update public.profiles set role='cliente', nome='Cliente Transfer' where id='e0000000-0000-0000-0000-000000000001';
update public.profiles set role='profissional', nome='Profissional Transfer' where id='e0000000-0000-0000-0000-000000000002';

insert into public.professionals (id, tipo, cidade, estado, verification_status)
values ('e0000000-0000-0000-0000-000000000002','autonomo','São Paulo','SP','verificado');

set local role authenticated;
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.salvar_chave_pix('cliente-a00001@pix.bcb.gov.br', 'aleatoria')$$, 'profissional cadastra chave PIX de teste');
reset role;

insert into public.jobs (id, cliente_id, job_type, has_equipment, cep, cidade, profissional_id, status) values
('b1000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','limpeza',false,'01001000','São Paulo','e0000000-0000-0000-0000-000000000002','em_execucao');

insert into public.orders (id, job_id, preco_servico, comissao_servico, total, payment_status) values
('b2000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',1000,70,1000,'pendente');

create temporary table transfer_ids (charge uuid, transfer_id uuid) on commit drop;
insert into transfer_ids default values;

update transfer_ids set charge = public.preparar_cobranca_order(
  'b2000000-0000-0000-0000-000000000001', 'asaas', 'PIX', 'transfer-charge-1'
);
select public.vincular_cobranca_gateway(
  (select charge from transfer_ids), 'pay_transfer_001', 'https://sandbox.asaas.com/i/t1', current_date + 2
);
select public.processar_evento_gateway(public.registrar_evento_gateway(
  'asaas','evt_transfer_001','PAYMENT_RECEIVED','pay_transfer_001',1000,'{}'::jsonb, now()
));

-- Sem janela de contenção neste teste — quero o repasse "pronto" assim que o
-- job concluir, sem depender de manipular timestamp manualmente.
update public.platform_config set repasse_janela_contencao_horas = 0;
update public.jobs set status = 'concluido' where id = 'b1000000-0000-0000-0000-000000000001';

update transfer_ids set transfer_id = (
  select id from public.payment_transfers where job_id = 'b1000000-0000-0000-0000-000000000001'
);

select is(
  (select status from public.payment_transfers where id = (select transfer_id from transfer_ids)),
  'pending_creation',
  'repasse nasce pending_creation, ainda não reservado'
);

-- ===========================================================================
-- Reserva atômica: primeira chamada pega a linha, segunda não pega mais nada
-- ===========================================================================
select is(
  (select count(*)::integer from public.listar_repasses_prontos(10)),
  1,
  'primeira reserva pega o repasse pronto'
);
select is(
  (select status from public.payment_transfers where id = (select transfer_id from transfer_ids)),
  'pending',
  'reserva já marca a linha como pending, antes de qualquer chamada ao Asaas'
);
select is(
  (select count(*)::integer from public.listar_repasses_prontos(10)),
  0,
  'segunda chamada não reencontra a mesma linha — sem risco de reenviar'
);

-- ===========================================================================
-- Vincula a resposta do Asaas e processa o webhook TRANSFER_DONE
-- ===========================================================================
select lives_ok(
  format(
    'select public.vincular_transferencia_gateway(%L::uuid, %L, %L)',
    (select transfer_id from transfer_ids), 'trf_asaas_001', 'PENDING'
  ),
  'vincula o id retornado pelo Asaas'
);
select is(
  (select gateway_transfer_id from public.payment_transfers where id = (select transfer_id from transfer_ids)),
  'trf_asaas_001',
  'gateway_transfer_id gravado'
);

select is(
  public.processar_evento_gateway_transferencia(public.registrar_evento_gateway_transferencia(
    'asaas', 'evt_transfer_done_001', 'TRANSFER_DONE', 'trf_asaas_001', '{}'::jsonb, now()
  )),
  'processed',
  'TRANSFER_DONE é processado'
);
select is(
  (select status from public.payment_transfers where id = (select transfer_id from transfer_ids)),
  'confirmed',
  'repasse confirmado após TRANSFER_DONE'
);
select is(
  (select count(*)::integer from public.financial_journals where journal_type = 'transfer_sent'),
  1,
  'repasse confirmado gera lançamento no ledger'
);
select is(
  (
    select coalesce(sum(amount) filter (where direction = 'debit'), 0)
         - coalesce(sum(amount) filter (where direction = 'credit'), 0)
      from public.financial_postings p
      join public.financial_journals j on j.id = p.journal_id
     where j.journal_type = 'transfer_sent'
  ),
  0.00::numeric,
  'partidas do repasse permanecem balanceadas'
);

-- Reprocessar o mesmo evento é idempotente — não duplica o lançamento.
select is(
  public.processar_evento_gateway_transferencia(
    (select id from public.payment_gateway_events where gateway_event_id = 'evt_transfer_done_001')
  ),
  'processed',
  'reprocessar TRANSFER_DONE é idempotente'
);
select is(
  (select count(*)::integer from public.financial_journals where journal_type = 'transfer_sent'),
  1,
  'reprocessamento não duplica o lançamento'
);

-- ===========================================================================
-- Falha antes de qualquer resposta útil do Asaas: nunca volta pra fila.
-- Fixture independente (job2/order2) para ter uma allocation própria — a
-- reserva já é única por allocation_id.
-- ===========================================================================
insert into public.jobs (id, cliente_id, job_type, has_equipment, cep, cidade, profissional_id, status) values
('b1000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000001','limpeza',false,'01001000','São Paulo','e0000000-0000-0000-0000-000000000002','em_execucao');
insert into public.orders (id, job_id, preco_servico, comissao_servico, total, payment_status) values
('b2000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000002',500,35,500,'pendente');

create temporary table transfer_ids_2 (charge uuid, transfer_id uuid) on commit drop;
insert into transfer_ids_2 default values;
update transfer_ids_2 set charge = public.preparar_cobranca_order(
  'b2000000-0000-0000-0000-000000000002', 'asaas', 'PIX', 'transfer-charge-2'
);
select public.vincular_cobranca_gateway(
  (select charge from transfer_ids_2), 'pay_transfer_002', 'https://sandbox.asaas.com/i/t2', current_date + 2
);
select public.processar_evento_gateway(public.registrar_evento_gateway(
  'asaas','evt_transfer_002','PAYMENT_RECEIVED','pay_transfer_002',500,'{}'::jsonb, now()
));
update public.jobs set status = 'concluido' where id = 'b1000000-0000-0000-0000-000000000002';
update transfer_ids_2 set transfer_id = (
  select id from public.payment_transfers where job_id = 'b1000000-0000-0000-0000-000000000002'
);

select * from public.listar_repasses_prontos(10);
select is(
  (select status from public.payment_transfers where id = (select transfer_id from transfer_ids_2)),
  'pending',
  'segundo repasse também é reservado antes de qualquer chamada ao Asaas'
);

select public.marcar_repasse_falho((select transfer_id from transfer_ids_2), 'timeout na chamada ao Asaas');
select is(
  (select status from public.payment_transfers where id = (select transfer_id from transfer_ids_2)),
  'failed',
  'falha na chamada marca o repasse como failed, nunca volta pra pending_creation'
);
select is(
  (select count(*)::integer from public.listar_repasses_prontos(10)),
  0,
  'repasse failed não é reencontrado pela reserva — não há reenvio automático'
);

select * from finish();
rollback;
