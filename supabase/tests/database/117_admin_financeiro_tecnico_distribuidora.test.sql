begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(11);

-- ===========================================================================
-- Fixture: dois técnicos (A, B), duas distribuidoras (C, D) e um admin.
--
-- Cobre o risco nº 1 do financeiro admin (ver plano da feature): jobs_admin_
-- read/orders_admin_read são globais, sem filtro por dono, então a barreira
-- real de isolamento entre técnicos/distribuidoras está inteira na RLS de
-- `expenses`/`distributor_expenses` — se ela vazar, a ficha financeira de um
-- mostra dado de outro. Este teste prova que a RLS segura, não a query da
-- tela, é quem impede isso.
-- ===========================================================================
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('11700000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fin-pro-a@teste.local','',now(),now()),
('11700000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fin-pro-b@teste.local','',now(),now()),
('11700000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fin-dist-c@teste.local','',now(),now()),
('11700000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fin-dist-d@teste.local','',now(),now()),
('11700000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fin-admin@teste.local','',now(),now());

update public.profiles set role='profissional', nome='Técnico Financeiro A' where id='11700000-0000-0000-0000-000000000001';
update public.profiles set role='profissional', nome='Técnico Financeiro B' where id='11700000-0000-0000-0000-000000000002';
update public.profiles set role='distribuidora', nome='Distribuidora Financeiro C' where id='11700000-0000-0000-0000-000000000003';
update public.profiles set role='distribuidora', nome='Distribuidora Financeiro D' where id='11700000-0000-0000-0000-000000000004';
update public.profiles set role='admin', nome='Admin Financeiro' where id='11700000-0000-0000-0000-000000000005';

insert into public.professionals(id,tipo,cidade,estado) values
('11700000-0000-0000-0000-000000000001','autonomo','São Paulo','SP'),
('11700000-0000-0000-0000-000000000002','autonomo','São Paulo','SP');

insert into public.distributors(id,razao_social,cidade,estado,prazo_entrega_dias,verification_status,ativo) values
('11700000-0000-0000-0000-000000000003','Distribuidora Financeiro C LTDA','São Paulo','SP',5,'verificado',true),
('11700000-0000-0000-0000-000000000004','Distribuidora Financeiro D LTDA','São Paulo','SP',5,'verificado',true);

insert into public.expenses(id,professional_id,categoria,descricao,valor,data) values
('11700000-0000-0000-0000-0000000000a1','11700000-0000-0000-0000-000000000001','outros','Despesa A',100,'2026-08-01'),
('11700000-0000-0000-0000-0000000000a2','11700000-0000-0000-0000-000000000002','outros','Despesa B',200,'2026-08-01');

insert into public.distributor_expenses(id,distributor_id,categoria,descricao,valor,data) values
('11700000-0000-0000-0000-0000000000b1','11700000-0000-0000-0000-000000000003','frete','Despesa C',300,'2026-08-01'),
('11700000-0000-0000-0000-0000000000b2','11700000-0000-0000-0000-000000000004','frete','Despesa D',400,'2026-08-01');

-- ===========================================================================
-- distributor_expenses: RLS habilitada e isolamento entre distribuidoras
-- ===========================================================================
select ok(
  (select relrowsecurity from pg_class where oid = 'public.distributor_expenses'::regclass),
  'distributor_expenses tem RLS habilitada'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','11700000-0000-0000-0000-000000000003',true);
select is(
  (select count(*)::integer from public.distributor_expenses),
  1,
  'distribuidora C vê só a própria despesa'
);
select throws_ok(
  $$insert into public.distributor_expenses(distributor_id,categoria,valor,data)
    values ('11700000-0000-0000-0000-000000000004','frete',50,'2026-08-01')$$,
  '42501',
  'new row violates row-level security policy for table "distributor_expenses"',
  'distribuidora C não lança despesa em nome de D'
);
reset role;

-- ===========================================================================
-- expenses: técnico continua isolado do outro técnico (regressão da policy
-- de dono, que não foi tocada — só ganhou uma policy de SELECT a mais)
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','11700000-0000-0000-0000-000000000001',true);
select is(
  (select count(*)::integer from public.expenses),
  1,
  'técnico A vê só a própria despesa'
);
select throws_ok(
  $$insert into public.expenses(professional_id,categoria,valor,data)
    values ('11700000-0000-0000-0000-000000000002','outros',50,'2026-08-01')$$,
  '42501',
  'new row violates row-level security policy for table "expenses"',
  'técnico A não lança despesa em nome de B'
);
reset role;

-- ===========================================================================
-- Admin: lê despesas de todo mundo (é pra isso que a policy nova existe),
-- mas continua sem poder escrever despesa alheia — só a distribuidora/técnico
-- dono grava a própria.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','11700000-0000-0000-0000-000000000005',true);

select is(
  (select count(*)::integer from public.expenses),
  2,
  'admin vê as despesas de A e B juntas'
);
select is(
  (select count(*)::integer from public.distributor_expenses),
  2,
  'admin vê as despesas de C e D juntas'
);
-- Nenhuma das duas tabelas grantou UPDATE (a UI só registra e remove, nunca
-- edita em lugar), então "admin não altera" não é testável por update — vira
-- "permission denied" pra qualquer papel, dono incluído, e não provaria nada
-- específico de admin. DELETE é grantado pra `authenticated`, então é aqui
-- que a RLS (e não o grant) precisa ser a barreira real.
--
-- CTE de escrita só é aceita no nível mais alto da própria instrução — por
-- isso o `with` envolve o `select is(...)` inteiro, e não fica dentro dele.
with del as (
  delete from public.expenses where professional_id = '11700000-0000-0000-0000-000000000001' returning 1
)
select is((select count(*)::integer from del), 0, 'admin não consegue apagar despesa de técnico');

with del as (
  delete from public.distributor_expenses where distributor_id = '11700000-0000-0000-0000-000000000003' returning 1
)
select is((select count(*)::integer from del), 0, 'admin não consegue apagar despesa de distribuidora');
reset role;

-- Confirma, fora do papel de admin, que as despesas continuam lá.
select is(
  (select valor::integer from public.expenses where id = '11700000-0000-0000-0000-0000000000a1'),
  100,
  'despesa do técnico A permanece intacta após tentativa de exclusão do admin'
);
select is(
  (select valor::integer from public.distributor_expenses where id = '11700000-0000-0000-0000-0000000000b1'),
  300,
  'despesa da distribuidora C permanece intacta após tentativa de exclusão do admin'
);

select * from finish();
rollback;
