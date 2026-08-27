begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);

select has_function('public', 'obter_receita_gmv_mensal', array['integer'], 'RPC de receita/GMV existe');

-- ===========================================================================
-- Fixture: um cliente, um profissional, três orders pagas via o fluxo real
-- (preparar_cobranca_order -> vincular_cobranca_gateway -> PAYMENT_RECEIVED),
-- não INSERT direto em financial_postings/financial_journals — testa o
-- caminho de verdade, o mesmo já usado em 104/108.
--   A — mês atual,   comissão 100, total 1000
--   B — mês passado, comissão  70, total  800  (occurred_at ~35 dias atrás)
--   C — mês atual,   comissão  50, total  500  (será reembolsada)
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) values
('a0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cliente-receita@teste.local','',now(),now()),
('a0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pro-receita@teste.local','',now(),now()),
('a0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-receita@teste.local','',now(),now());

update public.profiles set role='cliente', nome='Cliente Receita' where id='a0000000-0000-0000-0000-000000000001';
update public.profiles set role='profissional', nome='Profissional Receita' where id='a0000000-0000-0000-0000-000000000002';
update public.profiles set role='admin', nome='Admin Receita' where id='a0000000-0000-0000-0000-000000000003';

insert into public.professionals (id, tipo, cidade, estado, verification_status)
values ('a0000000-0000-0000-0000-000000000002','autonomo','São Paulo','SP','verificado');

insert into public.jobs (id, cliente_id, job_type, has_equipment, cep, cidade, profissional_id, status) values
('a1000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000001','limpeza',false,'01001000','São Paulo','a0000000-0000-0000-0000-000000000002','em_execucao'),
('a1000000-0000-0000-0000-00000000000b','a0000000-0000-0000-0000-000000000001','limpeza',false,'01001000','São Paulo','a0000000-0000-0000-0000-000000000002','em_execucao'),
('a1000000-0000-0000-0000-00000000000c','a0000000-0000-0000-0000-000000000001','limpeza',false,'01001000','São Paulo','a0000000-0000-0000-0000-000000000002','em_execucao');

-- created_at de cada order alinhado ao mês do respectivo evento — GMV agrupa
-- por orders.created_at, não por occurred_at do evento de pagamento.
insert into public.orders (id, job_id, preco_servico, comissao_servico, total, payment_status, created_at) values
('a2000000-0000-0000-0000-00000000000a','a1000000-0000-0000-0000-00000000000a',1000,100,1000,'pendente', now()),
('a2000000-0000-0000-0000-00000000000b','a1000000-0000-0000-0000-00000000000b', 800, 70, 800,'pendente', now() - interval '35 days'),
('a2000000-0000-0000-0000-00000000000c','a1000000-0000-0000-0000-00000000000c', 500, 50, 500,'pendente', now());

create temporary table receita_charges (letra text primary key, charge uuid) on commit drop;
insert into receita_charges (letra) values ('a'), ('b'), ('c');
grant select on receita_charges to authenticated;

update receita_charges set charge = public.preparar_cobranca_order(
  ('a2000000-0000-0000-0000-00000000000' || letra)::uuid, 'asaas', 'PIX', 'receita-charge-' || letra
);

select public.vincular_cobranca_gateway(
  (select charge from receita_charges where letra = l), 'pay_receita_' || l, 'https://sandbox.asaas.com/i/' || l, current_date + 2
)
from unnest(array['a','b','c']) as l;

-- B é liquidada com occurred_at de ~35 dias atrás; A e C no mês atual.
select public.processar_evento_gateway(public.registrar_evento_gateway(
  'asaas','evt_receita_a','PAYMENT_RECEIVED','pay_receita_a',1000,'{}'::jsonb, now()
));
select public.processar_evento_gateway(public.registrar_evento_gateway(
  'asaas','evt_receita_b','PAYMENT_RECEIVED','pay_receita_b',800,'{}'::jsonb, now() - interval '35 days'
));
select public.processar_evento_gateway(public.registrar_evento_gateway(
  'asaas','evt_receita_c','PAYMENT_RECEIVED','pay_receita_c',500,'{}'::jsonb, now()
));

-- ---------------------------------------------------------------------------
-- Não-admin não chama a RPC.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);
select throws_ok(
  $$select * from public.obter_receita_gmv_mensal(2)$$,
  'Acesso restrito a administradores.',
  'cliente não lê receita/GMV'
);
reset role;

-- ---------------------------------------------------------------------------
-- Antes do reembolso: mês atual soma A+C (receita 150, GMV 1500); mês
-- passado só B (receita 70, GMV 800). Sinal precisa vir POSITIVO — é
-- exatamente o ponto que motivou pedir migration em vez de cálculo em JS.
-- ---------------------------------------------------------------------------
create temporary table receita_antes (mes date, receita numeric, gmv numeric) on commit drop;
grant insert, select on receita_antes to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000003',true);
insert into receita_antes select * from public.obter_receita_gmv_mensal(2);
reset role;

select is((select count(*)::int from receita_antes), 2, 'RPC devolve 2 meses quando p_meses=2');
select is(
  (select mes from receita_antes order by mes desc limit 1),
  date_trunc('month', now() at time zone 'utc')::date,
  'linha mais recente é o mês corrente'
);
select is(
  (select receita from receita_antes order by mes desc limit 1),
  150.00::numeric,
  'receita do mês atual soma comissão de A e C, sinal positivo'
);
select is(
  (select gmv from receita_antes order by mes desc limit 1),
  1500.00::numeric,
  'GMV do mês atual soma o total de A e C'
);
select is(
  (select receita from receita_antes order by mes asc limit 1),
  70.00::numeric,
  'receita do mês passado é só a comissão de B'
);
select is(
  (select gmv from receita_antes order by mes asc limit 1),
  800.00::numeric,
  'GMV do mês passado é só o total de B'
);

-- ---------------------------------------------------------------------------
-- Reembolsa C — prova a inversão de sinal (credit vira debit) e que GMV some
-- junto (payment_status deixa de ser 'pago').
-- ---------------------------------------------------------------------------
select public.processar_evento_gateway(public.registrar_evento_gateway(
  'asaas','evt_receita_c_refund','PAYMENT_REFUNDED','pay_receita_c',500,'{}'::jsonb, now()
));

select is(
  (select payment_status from public.orders where id = 'a2000000-0000-0000-0000-00000000000c'),
  'reembolsado',
  'order C foi marcada como reembolsada'
);

create temporary table receita_depois (mes date, receita numeric, gmv numeric) on commit drop;
grant insert, select on receita_depois to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000003',true);
insert into receita_depois select * from public.obter_receita_gmv_mensal(2);
reset role;

select is(
  (select receita from receita_depois order by mes desc limit 1),
  100.00::numeric,
  'depois do reembolso, receita do mês atual cai pra só A (inversão de sinal provada)'
);
select is(
  (select gmv from receita_depois order by mes desc limit 1),
  1000.00::numeric,
  'depois do reembolso, GMV do mês atual cai pra só A'
);

-- ---------------------------------------------------------------------------
-- Mês sem nenhum lançamento não é pulado — vem com zero.
-- ---------------------------------------------------------------------------
create temporary table receita_seis_meses (mes date, receita numeric, gmv numeric) on commit drop;
grant insert, select on receita_seis_meses to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000003',true);
insert into receita_seis_meses select * from public.obter_receita_gmv_mensal(6);
reset role;

select is(
  (select count(*)::int from receita_seis_meses),
  6,
  'meses sem lançamento aparecem com zero, não são omitidos'
);

select * from finish();
rollback;
