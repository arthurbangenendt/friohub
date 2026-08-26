begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(18);

select has_function('public', 'admin_intervir_repasse', array['uuid','text','text'], 'RPC de intervenção em repasse existe');

-- ===========================================================================
-- Fixture: mesma sequência de 104_repasse_asaas_transfer — um cliente, um
-- profissional, quatro jobs pagos e concluídos (sem janela de contenção),
-- cada um gerando seu próprio payment_transfer em pending_creation. Cada job
-- é levado a um estado diferente antes do teste:
--   A -> failed      (via listar_repasses_prontos + marcar_repasse_falho)
--   B -> failed      (idem — pra testar cancelar SEM passar por reenviar)
--   C -> pending      (reservado, "em voo" — nunca pode ser cancelado)
--   D -> confirmed    (ciclo completo até TRANSFER_DONE — nunca pode ser cancelado)
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) values
('f0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cliente-interv@teste.local','',now(),now()),
('f0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pro-interv@teste.local','',now(),now()),
('f0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-interv@teste.local','',now(),now());

update public.profiles set role='cliente', nome='Cliente Interv' where id='f0000000-0000-0000-0000-000000000001';
update public.profiles set role='profissional', nome='Profissional Interv' where id='f0000000-0000-0000-0000-000000000002';
update public.profiles set role='admin', nome='Admin Interv' where id='f0000000-0000-0000-0000-000000000003';

insert into public.professionals (id, tipo, cidade, estado, verification_status)
values ('f0000000-0000-0000-0000-000000000002','autonomo','São Paulo','SP','verificado');

set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.salvar_chave_pix('interv-a00001@pix.bcb.gov.br', 'aleatoria')$$, 'profissional cadastra chave PIX de teste');
reset role;

update public.platform_config set repasse_janela_contencao_horas = 0;

insert into public.jobs (id, cliente_id, job_type, has_equipment, cep, cidade, profissional_id, status) values
('f1000000-0000-0000-0000-00000000000a','f0000000-0000-0000-0000-000000000001','limpeza',false,'01001000','São Paulo','f0000000-0000-0000-0000-000000000002','em_execucao'),
('f1000000-0000-0000-0000-00000000000b','f0000000-0000-0000-0000-000000000001','limpeza',false,'01001000','São Paulo','f0000000-0000-0000-0000-000000000002','em_execucao'),
('f1000000-0000-0000-0000-00000000000c','f0000000-0000-0000-0000-000000000001','limpeza',false,'01001000','São Paulo','f0000000-0000-0000-0000-000000000002','em_execucao'),
('f1000000-0000-0000-0000-00000000000d','f0000000-0000-0000-0000-000000000001','limpeza',false,'01001000','São Paulo','f0000000-0000-0000-0000-000000000002','em_execucao');

insert into public.orders (id, job_id, preco_servico, comissao_servico, total, payment_status) values
('f2000000-0000-0000-0000-00000000000a','f1000000-0000-0000-0000-00000000000a',500,35,500,'pendente'),
('f2000000-0000-0000-0000-00000000000b','f1000000-0000-0000-0000-00000000000b',500,35,500,'pendente'),
('f2000000-0000-0000-0000-00000000000c','f1000000-0000-0000-0000-00000000000c',500,35,500,'pendente'),
('f2000000-0000-0000-0000-00000000000d','f1000000-0000-0000-0000-00000000000d',500,35,500,'pendente');

create temporary table interv_charges (letra text primary key, charge uuid) on commit drop;
insert into interv_charges (letra) values ('a'), ('b'), ('c'), ('d');

update interv_charges set charge = public.preparar_cobranca_order(
  ('f2000000-0000-0000-0000-00000000000' || letra)::uuid, 'asaas', 'PIX', 'interv-charge-' || letra
);

select public.vincular_cobranca_gateway(
  (select charge from interv_charges where letra = l), 'pay_interv_' || l, 'https://sandbox.asaas.com/i/' || l, current_date + 2
)
from unnest(array['a','b','c','d']) as l;

select public.processar_evento_gateway(public.registrar_evento_gateway(
  'asaas', 'evt_interv_' || l, 'PAYMENT_RECEIVED', 'pay_interv_' || l, 500, '{}'::jsonb, now()
))
from unnest(array['a','b','c','d']) as l;

update public.jobs set status = 'concluido'
 where id in (
   'f1000000-0000-0000-0000-00000000000a','f1000000-0000-0000-0000-00000000000b',
   'f1000000-0000-0000-0000-00000000000c','f1000000-0000-0000-0000-00000000000d'
 );

create temporary table interv_transfers (letra text primary key, transfer_id uuid) on commit drop;
insert into interv_transfers (letra, transfer_id)
  select right(job_id::text, 1), id from public.payment_transfers
   where job_id in (
     'f1000000-0000-0000-0000-00000000000a','f1000000-0000-0000-0000-00000000000b',
     'f1000000-0000-0000-0000-00000000000c','f1000000-0000-0000-0000-00000000000d'
   );
grant select on interv_transfers to authenticated;

-- A e B: reserva (pending_creation -> pending) e falha (pending -> failed).
select public.listar_repasses_prontos(10);
select public.marcar_repasse_falho((select transfer_id from interv_transfers where letra='a'), 'timeout simulado em teste');
select public.marcar_repasse_falho((select transfer_id from interv_transfers where letra='b'), 'timeout simulado em teste');

-- C: fica reservado em "pending" — simula transferência em voo no gateway.
select public.listar_repasses_prontos(10);

-- D: ciclo completo até confirmado, mesmo caminho do teste 104.
select public.vincular_transferencia_gateway((select transfer_id from interv_transfers where letra='d'), 'trf_interv_d', 'PENDING');
select public.processar_evento_gateway_transferencia(public.registrar_evento_gateway_transferencia(
  'asaas', 'evt_interv_transfer_done_d', 'TRANSFER_DONE', 'trf_interv_d', '{}'::jsonb, now()
));

select is(
  (select status from public.payment_transfers where id = (select transfer_id from interv_transfers where letra='a')),
  'failed', 'fixture A chegou em failed'
);
select is(
  (select status from public.payment_transfers where id = (select transfer_id from interv_transfers where letra='c')),
  'pending', 'fixture C ficou reservado em pending (em voo)'
);
select is(
  (select status from public.payment_transfers where id = (select transfer_id from interv_transfers where letra='d')),
  'confirmed', 'fixture D chegou confirmado'
);

-- ---------------------------------------------------------------------------
-- Não-admin não intervém.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-0000-0000-000000000002',true);
select throws_ok(
  format('select public.admin_intervir_repasse(%L::uuid, %L, %L)', (select transfer_id from interv_transfers where letra='a'), 'reenviar', 'tentativa indevida'),
  'Acesso restrito a administradores.',
  'profissional não intervém em repasse'
);
reset role;

-- ---------------------------------------------------------------------------
-- Admin reenvia A (failed -> pending_creation), preservando idempotency_key.
-- ---------------------------------------------------------------------------
create temporary table interv_idempotency (letra text primary key, chave text) on commit drop;
insert into interv_idempotency (letra, chave)
  select t.letra, pt.idempotency_key
    from interv_transfers t join public.payment_transfers pt on pt.id = t.transfer_id;
grant select on interv_idempotency to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-0000-0000-000000000003',true);
select lives_ok(
  format('select public.admin_intervir_repasse(%L::uuid, %L, %L)', (select transfer_id from interv_transfers where letra='a'), 'reenviar', 'gateway caiu, reenviando manualmente'),
  'admin reenvia repasse failed'
);
reset role;

select is(
  (select status from public.payment_transfers where id = (select transfer_id from interv_transfers where letra='a')),
  'pending_creation', 'A voltou pra pending_creation'
);
select is(
  (select idempotency_key from public.payment_transfers where id = (select transfer_id from interv_transfers where letra='a')),
  (select chave from interv_idempotency where letra='a'),
  'idempotency_key não muda no reenvio — sem risco de PIX duplicado'
);
select is(
  (select last_error from public.payment_transfers where id = (select transfer_id from interv_transfers where letra='a')),
  null, 'erro antigo é limpo depois do reenvio'
);

-- ---------------------------------------------------------------------------
-- Reenviar de novo agora falha — A não está mais em "failed".
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-0000-0000-000000000003',true);
select throws_like(
  format('select public.admin_intervir_repasse(%L::uuid, %L, %L)', (select transfer_id from interv_transfers where letra='a'), 'reenviar', 'tentando reenviar de novo'),
  'Só é possível reenviar%',
  'reenviar só funciona a partir de failed'
);

-- Cancelar A (agora em pending_creation) funciona.
select lives_ok(
  format('select public.admin_intervir_repasse(%L::uuid, %L, %L)', (select transfer_id from interv_transfers where letra='a'), 'cancelar', 'pedido duplicado, cancelando'),
  'admin cancela repasse em pending_creation'
);
select is(
  (select status from public.payment_transfers where id = (select transfer_id from interv_transfers where letra='a')),
  'cancelled', 'A foi cancelado'
);

-- Cancelar B (em failed, sem passar por reenviar) também funciona.
select lives_ok(
  format('select public.admin_intervir_repasse(%L::uuid, %L, %L)', (select transfer_id from interv_transfers where letra='b'), 'cancelar', 'chave PIX inválida, não vale reenviar'),
  'admin cancela repasse em failed'
);

-- Cancelar C (pending, em voo) é recusado — pode já ter saído no gateway.
select throws_like(
  format('select public.admin_intervir_repasse(%L::uuid, %L, %L)', (select transfer_id from interv_transfers where letra='c'), 'cancelar', 'tentando cancelar em voo'),
  'Só é possível cancelar%',
  'cancelar recusado quando o repasse está em voo (pending)'
);

-- Cancelar D (confirmed) é recusado — dinheiro já saiu.
select throws_like(
  format('select public.admin_intervir_repasse(%L::uuid, %L, %L)', (select transfer_id from interv_transfers where letra='d'), 'cancelar', 'tentando cancelar já confirmado'),
  'Só é possível cancelar%',
  'cancelar recusado quando o repasse já foi confirmado'
);

-- Justificativa curta é recusada.
select throws_ok(
  format('select public.admin_intervir_repasse(%L::uuid, %L, %L)', (select transfer_id from interv_transfers where letra='b'), 'cancelar', 'x'),
  'Informe uma justificativa entre 5 e 500 caracteres.',
  'justificativa curta é recusada'
);
reset role;

select is(
  (select count(*)::int from public.admin_audit_log where entity_type='payment_transfers' and action='payment_transfer_intervention'),
  3,
  'as três intervenções bem-sucedidas (reenviar A, cancelar A, cancelar B) ficaram auditadas'
);

select * from finish();
rollback;
