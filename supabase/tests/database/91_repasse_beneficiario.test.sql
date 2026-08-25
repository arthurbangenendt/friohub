begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

select ok(
  exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='payment_allocations'
       and policyname='payment_allocations_beneficiario_read'
  ),
  'beneficiário possui política de leitura do próprio rateio'
);

/* A abertura é só de leitura. O rateio nasce dentro de
   `preparar_cobranca_order`, que é exclusiva de service_role. */
select ok(
  not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='payment_allocations'
       and cmd in ('INSERT','UPDATE','DELETE','ALL')
  ),
  'rateio continua sem escrita direta pela Data API'
);
select ok(
  not has_function_privilege('authenticated','public.preparar_cobranca_order(uuid,text,text,text)','EXECUTE'),
  'preparar cobrança segue exclusiva de service_role'
);
select ok(
  not has_function_privilege('authenticated','public.registrar_lancamento_financeiro(uuid,uuid,text,text,text,text,timestamp with time zone,jsonb,uuid,uuid)','EXECUTE'),
  'lançamento no ledger segue exclusivo de service_role'
);

-- ---------------------------------------------------------------------------
-- Cenário: uma cobrança com rateio para o profissional e receita da plataforma
-- ---------------------------------------------------------------------------
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('91000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','repasse-cliente@teste.local','',now(),now()),
('91000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','repasse-pro@teste.local','',now(),now()),
('91000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','repasse-intruso@teste.local','',now(),now());
update public.profiles set role='profissional' where id='91000000-0000-0000-0000-000000000002';
insert into public.professionals(id,tipo,cidade,estado) values ('91000000-0000-0000-0000-000000000002','autonomo','São Paulo','SP');

insert into public.jobs(id,cliente_id,profissional_id,job_type,status,cep,cidade)
values ('91000000-0000-0000-0000-0000000000aa','91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000002','manutencao','concluido','01310100','São Paulo');

insert into public.orders(id,job_id,preco_servico,comissao_servico,total,payment_status)
values ('91000000-0000-0000-0000-0000000000bb','91000000-0000-0000-0000-0000000000aa',1000,150,1000,'pago');

insert into public.payment_charges(id,order_id,customer_id,gateway,idempotency_key,external_reference,amount,status)
values ('91000000-0000-0000-0000-0000000000cc','91000000-0000-0000-0000-0000000000bb','91000000-0000-0000-0000-000000000001','asaas','idem-91','ref-91',1000,'received');

insert into public.payment_allocations(charge_id,allocation_type,beneficiary_id,amount) values
('91000000-0000-0000-0000-0000000000cc','professional_payable','91000000-0000-0000-0000-000000000002',850),
-- Receita da plataforma não tem beneficiário: é o caso que precisa continuar invisível.
('91000000-0000-0000-0000-0000000000cc','platform_commission',null,150);

set local role authenticated;

select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000002',true);
select is(
  (select count(*)::integer from public.payment_allocations),
  1,
  'profissional enxerga exatamente o próprio rateio'
);
select is(
  (select amount from public.payment_allocations),
  850::numeric,
  'valor visto é o do snapshot, não um recálculo sobre a comissão atual'
);
select is(
  (select count(*)::integer from public.payment_allocations where allocation_type='platform_commission'),
  0,
  'receita da plataforma permanece invisível ao profissional'
);

select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000003',true);
select is(
  (select count(*)::integer from public.payment_allocations),
  0,
  'terceiro não enxerga rateio de ninguém'
);

/* O cliente lê a própria cobrança pela view, que não expõe rateio nem payload
   do gateway. */
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
select is(
  (select count(*)::integer from public.payment_status_cliente where order_id='91000000-0000-0000-0000-0000000000bb'),
  1,
  'cliente acompanha a própria cobrança'
);

select * from finish();
rollback;
