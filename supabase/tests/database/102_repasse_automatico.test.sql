begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);

select has_table('public', 'payment_transfers', 'reserva de repasse existe');
select has_column('public', 'payment_transfers', 'scheduled_for', 'repasse tem janela de contenção');
select has_column('public', 'payment_transfers', 'contestado_em', 'repasse pode ser contestado');
select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'payment_transfers'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ),
  'Data API não escreve diretamente em payment_transfers'
);
select ok(
  not has_function_privilege('authenticated', 'public.preparar_repasse_profissional(uuid)', 'execute'),
  'preparar_repasse_profissional não é chamável pela Data API'
);

-- ===========================================================================
-- Fixture: mesma sequência de 50_financial_ledger (cobrança real, liquidada)
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) values
('c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cliente-repasse@teste.local','',now(),now()),
('c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pro-repasse@teste.local','',now(),now()),
('c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pro-repasse-sempix@teste.local','',now(),now());

update public.profiles set role='cliente', nome='Cliente Repasse' where id='c0000000-0000-0000-0000-000000000001';
update public.profiles set role='profissional', nome='Profissional Repasse' where id='c0000000-0000-0000-0000-000000000002';
update public.profiles set role='profissional', nome='Profissional Sem Pix' where id='c0000000-0000-0000-0000-000000000003';

insert into public.professionals (id, tipo, cidade, estado, verification_status) values
('c0000000-0000-0000-0000-000000000002','autonomo','São Paulo','SP','verificado'),
('c0000000-0000-0000-0000-000000000003','autonomo','São Paulo','SP','verificado');

set local role authenticated;
select set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.salvar_chave_pix('99988877766', 'cpf')$$, 'profissional cadastra a própria chave PIX');
reset role;

insert into public.jobs (id, cliente_id, job_type, has_equipment, cep, cidade, profissional_id, status) values
('d0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','limpeza',false,'01001000','São Paulo','c0000000-0000-0000-0000-000000000002','em_execucao'),
('d0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','limpeza',false,'01001000','São Paulo','c0000000-0000-0000-0000-000000000003','em_execucao');

insert into public.orders (id, job_id, preco_servico, comissao_servico, total, payment_status) values
('e0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001',1000,70,1000,'pendente'),
('e0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000002',500,35,500,'pendente');

-- Cobrança real, ponta a ponta, usando as RPCs já existentes do ADR financeiro.
create temporary table repasse_ids (charge1 uuid, charge2 uuid) on commit drop;
insert into repasse_ids default values;

update repasse_ids set charge1 = public.preparar_cobranca_order(
  'e0000000-0000-0000-0000-000000000001', 'asaas', 'PIX', 'repasse-charge-1'
);
update repasse_ids set charge2 = public.preparar_cobranca_order(
  'e0000000-0000-0000-0000-000000000002', 'asaas', 'PIX', 'repasse-charge-2'
);
select lives_ok(
  format('select public.vincular_cobranca_gateway(%L::uuid, %L, %L, current_date + 2)',
    (select charge1 from repasse_ids), 'pay_repasse_001', 'https://sandbox.asaas.com/i/r1'),
  'vincula cobrança 1 ao gateway'
);
select lives_ok(
  format('select public.vincular_cobranca_gateway(%L::uuid, %L, %L, current_date + 2)',
    (select charge2 from repasse_ids), 'pay_repasse_002', 'https://sandbox.asaas.com/i/r2'),
  'vincula cobrança 2 ao gateway'
);
select public.processar_evento_gateway(public.registrar_evento_gateway(
  'asaas','evt_repasse_001','PAYMENT_RECEIVED','pay_repasse_001',1000,'{}'::jsonb, now()
));
select public.processar_evento_gateway(public.registrar_evento_gateway(
  'asaas','evt_repasse_002','PAYMENT_RECEIVED','pay_repasse_002',500,'{}'::jsonb, now()
));

-- ===========================================================================
-- Conclusão do job: só ela dispara o preparo (nunca antes da liquidação)
-- ===========================================================================
select is(
  (select count(*)::integer from public.payment_transfers),
  0,
  'nenhum repasse existe antes do job ser concluído'
);

update public.jobs set status = 'concluido' where id = 'd0000000-0000-0000-0000-000000000001';
update public.jobs set status = 'concluido' where id = 'd0000000-0000-0000-0000-000000000002';

select is(
  (select status from public.payment_transfers where job_id = 'd0000000-0000-0000-0000-000000000001'),
  'pending_creation',
  'repasse do profissional com PIX cadastrado nasce pendente, não confirmado direto'
);
select is(
  (select amount from public.payment_transfers where job_id = 'd0000000-0000-0000-0000-000000000001'),
  930.00::numeric(12,2),
  'valor do repasse é o que sobra pro profissional (1000 - 70 de comissão)'
);
select ok(
  (select scheduled_for from public.payment_transfers where job_id = 'd0000000-0000-0000-0000-000000000001') > now(),
  'repasse fica agendado no futuro — janela de contenção, não disparo imediato'
);
select is(
  (select status from public.payment_transfers where job_id = 'd0000000-0000-0000-0000-000000000002'),
  'failed',
  'profissional sem chave PIX cadastrada gera repasse já marcado como falho, sem travar o job'
);

-- Reprocessar a mesma transição não duplica (idempotência por allocation_id).
update public.jobs set status = 'em_execucao' where id = 'd0000000-0000-0000-0000-000000000001';
update public.jobs set status = 'concluido' where id = 'd0000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::integer from public.payment_transfers where job_id = 'd0000000-0000-0000-0000-000000000001'),
  1,
  'reconcluir o mesmo job não duplica o repasse'
);

-- ===========================================================================
-- Contestação do cliente
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000001',true);

select throws_ok(
  $$select public.contestar_execucao_job('d0000000-0000-0000-0000-000000000002', 'nada foi feito')$$,
  'Não há repasse pendente para contestar neste serviço — ele já foi processado ou ainda não foi preparado.',
  'não dá pra contestar repasse que já não está mais pendente (aqui, o que falhou por falta de PIX)'
);
select lives_ok(
  $$select public.contestar_execucao_job('d0000000-0000-0000-0000-000000000001', 'profissional não compareceu')$$,
  'cliente contesta a execução dentro da janela'
);
reset role;

select is(
  (select status from public.payment_transfers where job_id = 'd0000000-0000-0000-0000-000000000001'),
  'cancelled',
  'contestação cancela o repasse — ninguém recebe até o financeiro resolver manualmente'
);

select * from finish();
rollback;
