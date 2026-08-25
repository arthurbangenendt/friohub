begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(25);

select has_table('public', 'job_disputes', 'fila de disputas existe');
select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'job_disputes'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ),
  'Data API não escreve diretamente em job_disputes'
);

-- ===========================================================================
-- Fixture: cliente, admin, profissional com PIX, 3 jobs pagos
--   A — concluído, contestado, reembolso PARCIAL (excede a comissão)
--   B — em execução, cancelamento com reembolso TOTAL
--   C — concluído, contestado, disputa REJEITADA (repasse reativado)
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) values
('b1000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cliente-disputa@teste.local','',now(),now()),
('b1000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pro-disputa@teste.local','',now(),now()),
('b1000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-disputa@teste.local','',now(),now());

update public.profiles set role='cliente', nome='Cliente Disputa' where id='b1000000-0000-0000-0000-000000000001';
update public.profiles set role='profissional', nome='Profissional Disputa' where id='b1000000-0000-0000-0000-000000000002';
update public.profiles set role='admin', nome='Admin Disputa' where id='b1000000-0000-0000-0000-000000000003';

insert into public.professionals (id, tipo, cidade, estado, verification_status) values
('b1000000-0000-0000-0000-000000000002','autonomo','São Paulo','SP','verificado');

set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000002',true);
select public.salvar_chave_pix('11122233344', 'cpf');
reset role;

insert into public.jobs (id, cliente_id, job_type, has_equipment, cep, cidade, profissional_id, status) values
('b2000000-0000-0000-0000-00000000000a','b1000000-0000-0000-0000-000000000001','limpeza',false,'01001000','São Paulo','b1000000-0000-0000-0000-000000000002','em_execucao'),
('b2000000-0000-0000-0000-00000000000b','b1000000-0000-0000-0000-000000000001','limpeza',false,'01001000','São Paulo','b1000000-0000-0000-0000-000000000002','em_execucao'),
('b2000000-0000-0000-0000-00000000000c','b1000000-0000-0000-0000-000000000001','limpeza',false,'01001000','São Paulo','b1000000-0000-0000-0000-000000000002','em_execucao');

insert into public.orders (id, job_id, preco_servico, comissao_servico, total, payment_status) values
('b3000000-0000-0000-0000-00000000000a','b2000000-0000-0000-0000-00000000000a',1000,100,1000,'pendente'),
('b3000000-0000-0000-0000-00000000000b','b2000000-0000-0000-0000-00000000000b',500,50,500,'pendente'),
('b3000000-0000-0000-0000-00000000000c','b2000000-0000-0000-0000-00000000000c',200,20,200,'pendente');

create temporary table disputa_charges (charge_a uuid, charge_b uuid, charge_c uuid) on commit drop;
insert into disputa_charges default values;

update disputa_charges set charge_a = public.preparar_cobranca_order('b3000000-0000-0000-0000-00000000000a', 'asaas', 'PIX', 'disputa-charge-a');
update disputa_charges set charge_b = public.preparar_cobranca_order('b3000000-0000-0000-0000-00000000000b', 'asaas', 'PIX', 'disputa-charge-b');
update disputa_charges set charge_c = public.preparar_cobranca_order('b3000000-0000-0000-0000-00000000000c', 'asaas', 'PIX', 'disputa-charge-c');

select public.vincular_cobranca_gateway((select charge_a from disputa_charges), 'pay_disputa_a', 'https://sandbox.asaas.com/i/a', current_date + 2);
select public.vincular_cobranca_gateway((select charge_b from disputa_charges), 'pay_disputa_b', 'https://sandbox.asaas.com/i/b', current_date + 2);
select public.vincular_cobranca_gateway((select charge_c from disputa_charges), 'pay_disputa_c', 'https://sandbox.asaas.com/i/c', current_date + 2);

select public.processar_evento_gateway(public.registrar_evento_gateway('asaas','evt_disputa_a','PAYMENT_RECEIVED','pay_disputa_a',1000,'{}'::jsonb, now()));
select public.processar_evento_gateway(public.registrar_evento_gateway('asaas','evt_disputa_b','PAYMENT_RECEIVED','pay_disputa_b',500,'{}'::jsonb, now()));
select public.processar_evento_gateway(public.registrar_evento_gateway('asaas','evt_disputa_c','PAYMENT_RECEIVED','pay_disputa_c',200,'{}'::jsonb, now()));

-- Job A e C concluídos (job B fica em_execucao — é o caso de cancelamento).
update public.jobs set status = 'concluido' where id in ('b2000000-0000-0000-0000-00000000000a','b2000000-0000-0000-0000-00000000000c');

select is(
  (select amount from public.payment_transfers where job_id = 'b2000000-0000-0000-0000-00000000000a'),
  900.00::numeric(12,2),
  'repasse do job A nasce com o valor cheio (1000 - 100 de comissão)'
);

-- ===========================================================================
-- Job A: contestação → aprovação com reembolso PARCIAL (300, excede a
-- comissão de 100) → comissão absorve 100, profissional perde os 200 que
-- faltam do repasse.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
select lives_ok(
  $$select public.contestar_execucao_job('b2000000-0000-0000-0000-00000000000a', 'serviço com defeito')$$,
  'cliente contesta o job A'
);
reset role;

select is(
  (select situacao_repasse from public.job_disputes where job_id = 'b2000000-0000-0000-0000-00000000000a'),
  'bloqueado',
  'contestação do job A bloqueou o repasse'
);

create temporary table disputa_a_id (id uuid) on commit drop;
insert into disputa_a_id select id from public.job_disputes where job_id = 'b2000000-0000-0000-0000-00000000000a';

select throws_ok(
  format('select public.preparar_reembolso_disputa(%L::uuid, 300, %L::uuid, %L)',
    (select id from disputa_a_id), 'b1000000-0000-0000-0000-000000000001', 'motivo de teste'),
  'Apenas administradores podem resolver disputas.',
  'cliente não pode preparar reembolso — só admin'
);

select lives_ok(
  format('select public.preparar_reembolso_disputa(%L::uuid, 300, %L::uuid, %L)',
    (select id from disputa_a_id), 'b1000000-0000-0000-0000-000000000003', 'reembolso parcial aprovado pelo admin'),
  'admin prepara reembolso parcial do job A'
);
select is(
  (select status from public.job_disputes where id = (select id from disputa_a_id)),
  'processando_reembolso',
  'disputa do job A fica processando_reembolso após preparar'
);

select lives_ok(
  format('select public.confirmar_reembolso_disputa(%L::uuid, %L::jsonb)',
    (select id from disputa_a_id),
    jsonb_build_array(jsonb_build_object('charge_id', (select charge_a from disputa_charges), 'valor', 300, 'sucesso', true, 'erro', null))::text),
  'confirma o reembolso parcial do job A'
);

select is(
  (select status from public.job_disputes where id = (select id from disputa_a_id)),
  'aprovada_reembolso_parcial',
  'disputa do job A fecha como reembolso parcial'
);
select is(
  (select status from public.payment_charges where id = (select charge_a from disputa_charges)),
  'partially_refunded',
  'cobrança do job A fica partially_refunded'
);
select is(
  (select status from public.payment_transfers where job_id = 'b2000000-0000-0000-0000-00000000000a'),
  'pending_creation',
  'repasse do job A é reativado (contestação aprovada não é rejeição — profissional ainda recebe o que sobrar)'
);
select is(
  (select amount from public.payment_transfers where job_id = 'b2000000-0000-0000-0000-00000000000a'),
  700.00::numeric(12,2),
  'valor do repasse do job A cai para 700 (900 - 200 que excederam a comissão de 100)'
);
select is(
  (select round(coalesce(sum(amount) filter (where direction='debit'),0) - coalesce(sum(amount) filter (where direction='credit'),0), 2)
     from public.financial_postings p join public.financial_journals j on j.id = p.journal_id
    where j.charge_id = (select charge_a from disputa_charges) and j.journal_type = 'payment_reversed'),
  0.00::numeric,
  'lançamento de reversão do job A fecha (débito = crédito)'
);

select throws_ok(
  format('select public.aplicar_reembolso_proporcional(%L::uuid, 50, %L, now())',
    (select charge_a from disputa_charges), 'disputa-dupla-teste'),
  'Esta cobrança já teve reembolso registrado — revise manualmente.',
  'não deixa reembolsar a mesma cobrança duas vezes'
);

-- ===========================================================================
-- Job B: cancelamento em execução → reembolso TOTAL → job vai para cancelado.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
select lives_ok(
  $$select public.solicitar_cancelamento_job_pago('b2000000-0000-0000-0000-00000000000b', 'profissional não apareceu')$$,
  'cliente solicita cancelamento do job B, ainda em execução'
);
reset role;

select is(
  (select status from public.jobs where id = 'b2000000-0000-0000-0000-00000000000b'),
  'em_execucao',
  'job B continua em execução enquanto a disputa está aberta — nada é desfeito antes da decisão do admin'
);

create temporary table disputa_b_id (id uuid) on commit drop;
insert into disputa_b_id select id from public.job_disputes where job_id = 'b2000000-0000-0000-0000-00000000000b';

select public.preparar_reembolso_disputa((select id from disputa_b_id), 500, 'b1000000-0000-0000-0000-000000000003', 'cancelamento aprovado — reembolso total');
select public.confirmar_reembolso_disputa(
  (select id from disputa_b_id),
  jsonb_build_array(jsonb_build_object('charge_id', (select charge_b from disputa_charges), 'valor', 500, 'sucesso', true, 'erro', null))
);

select is(
  (select status from public.jobs where id = 'b2000000-0000-0000-0000-00000000000b'),
  'cancelado',
  'job B é cancelado só depois do reembolso total confirmado'
);
select is(
  (select payment_status from public.orders where id = 'b3000000-0000-0000-0000-00000000000b'),
  'reembolsado',
  'order do job B fica reembolsada'
);
select is(
  (select status from public.job_disputes where id = (select id from disputa_b_id)),
  'aprovada_reembolso_total',
  'disputa do job B fecha como reembolso total'
);

-- ===========================================================================
-- Job C: contestação REJEITADA → repasse reativado com o valor original.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
select public.contestar_execucao_job('b2000000-0000-0000-0000-00000000000c', 'achei caro');
reset role;

create temporary table disputa_c_id (id uuid) on commit drop;
insert into disputa_c_id select id from public.job_disputes where job_id = 'b2000000-0000-0000-0000-00000000000c';
grant select on disputa_c_id to authenticated;

select is(
  (select status from public.payment_transfers where job_id = 'b2000000-0000-0000-0000-00000000000c'),
  'cancelled',
  'repasse do job C fica travado enquanto a disputa está aberta'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000003',true);
select lives_ok(
  format('select public.resolver_disputa_rejeitar(%L::uuid, %L)', (select id from disputa_c_id), 'motivo do cliente não procede'),
  'admin rejeita a disputa do job C'
);
reset role;

select is(
  (select status from public.job_disputes where id = (select id from disputa_c_id)),
  'rejeitada',
  'disputa do job C fica rejeitada'
);
select is(
  (select status from public.payment_transfers where job_id = 'b2000000-0000-0000-0000-00000000000c'),
  'pending_creation',
  'rejeição reativa o repasse do job C'
);
select is(
  (select amount from public.payment_transfers where job_id = 'b2000000-0000-0000-0000-00000000000c'),
  180.00::numeric(12,2),
  'valor do repasse do job C volta integral (200 - 20 de comissão) — rejeição não mexe no rateio'
);

select * from finish();
rollback;
