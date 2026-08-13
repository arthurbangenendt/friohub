begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(34);

select has_table('public', 'payment_customers', 'cadastro do pagador existe');
select has_table('public', 'payment_charges', 'cobranças são separadas de orders');
select has_table('public', 'payment_allocations', 'alocação econômica possui snapshot');
select has_table('public', 'payment_gateway_events', 'eventos brutos do gateway são persistidos');
select has_table('public', 'financial_journals', 'diário financeiro existe');
select has_table('public', 'financial_postings', 'partidas contábeis existem');
select has_table('public', 'financial_reconciliation_runs', 'execuções de reconciliação existem');
select has_table('public', 'financial_reconciliation_items', 'divergências financeiras existem');
select ok(
  'security_invoker=true' = any(
    coalesce(
      (select reloptions from pg_class where oid = 'public.payment_status_cliente'::regclass),
      array[]::text[]
    )
  ),
  'view financeira do cliente respeita RLS do invocador'
);

select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in (
         'payment_customers', 'payment_charges', 'payment_allocations',
         'payment_gateway_events', 'financial_journals', 'financial_postings'
       )
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ),
  'Data API não escreve diretamente em tabelas financeiras'
);

select ok(
  not has_function_privilege('authenticated', 'public.preparar_cobranca_order(uuid,text,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.preparar_cobranca_order(uuid,text,text,text)', 'execute'),
  'somente backend confiável prepara cobrança'
);
select ok(
  not has_function_privilege('authenticated', 'public.registrar_evento_gateway(text,text,text,text,numeric,jsonb,timestamp with time zone)', 'execute')
  and has_function_privilege('service_role', 'public.registrar_evento_gateway(text,text,text,text,numeric,jsonb,timestamp with time zone)', 'execute'),
  'somente backend confiável registra webhook'
);
select ok(
  not has_function_privilege('authenticated', 'public.processar_evento_gateway(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.processar_evento_gateway(uuid)', 'execute'),
  'somente backend confiável processa evento financeiro'
);

select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'payment_charges'
       and indexname = 'uq_payment_charges_active_order'
       and indexdef ilike '%unique%where%'
  ),
  'uma order possui no máximo uma cobrança ativa'
);
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'payment_gateway_events'
       and indexname = 'idx_payment_gateway_events_pending'
       and indexdef ilike '%where%'
  ),
  'fila de eventos pendentes usa índice parcial'
);

-- Fixture mínima, toda dentro da transação revertida ao final.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cliente-financeiro@teste.local', '', now(), now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro-financeiro@teste.local', '', now(), now());

update public.profiles set role = 'cliente', nome = 'Cliente Financeiro'
 where id = '10000000-0000-0000-0000-000000000001';
update public.profiles set role = 'profissional', nome = 'Profissional Financeiro'
 where id = '10000000-0000-0000-0000-000000000002';

insert into public.professionals (id, tipo, cidade, estado, verification_status)
values ('10000000-0000-0000-0000-000000000002', 'autonomo', 'São Paulo', 'SP', 'verificado');

insert into public.jobs (
  id, cliente_id, job_type, has_equipment, cep, cidade, profissional_id, status
) values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'limpeza', false, '01001000', 'São Paulo',
  '10000000-0000-0000-0000-000000000002', 'aguardando_profissional'
);

insert into public.orders (
  id, job_id, preco_servico, comissao_servico, total, payment_status
) values (
  '30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  100, 15, 100, 'pendente'
);

create temporary table phase3_ids (
  first_charge uuid,
  second_charge uuid,
  received_event uuid,
  duplicate_event uuid,
  confirmed_event uuid,
  refund_event uuid,
  reconciliation_run uuid
) on commit drop;
insert into phase3_ids default values;

update phase3_ids set first_charge = public.preparar_cobranca_order(
  '30000000-0000-0000-0000-000000000001', 'asaas', 'UNDEFINED', 'charge-order-1'
);
update phase3_ids set second_charge = public.preparar_cobranca_order(
  '30000000-0000-0000-0000-000000000001', 'asaas', 'UNDEFINED', 'charge-order-1'
);

select is(first_charge, second_charge, 'preparação repetida devolve a mesma cobrança') from phase3_ids;
select is(
  (select count(*)::integer from public.payment_charges where order_id = '30000000-0000-0000-0000-000000000001'),
  1,
  'idempotência cria uma única cobrança'
);
select is(
  (select sum(amount) from public.payment_allocations where charge_id = (select first_charge from phase3_ids)),
  100.00::numeric,
  'alocações fecham exatamente com o total cobrado'
);

select lives_ok(
  format(
    'select public.vincular_cobranca_gateway(%L::uuid, %L, %L, current_date + 2)',
    (select first_charge from phase3_ids), 'pay_asaas_001', 'https://sandbox.asaas.com/i/001'
  ),
  'backend vincula a identidade retornada pelo gateway'
);

update phase3_ids set received_event = public.registrar_evento_gateway(
  'asaas', 'evt_received_001', 'PAYMENT_RECEIVED', 'pay_asaas_001', 100,
  '{"event":"PAYMENT_RECEIVED"}'::jsonb, now()
);
update phase3_ids set duplicate_event = public.registrar_evento_gateway(
  'asaas', 'evt_received_001', 'PAYMENT_RECEIVED', 'pay_asaas_001', 100,
  '{"event":"PAYMENT_RECEIVED"}'::jsonb, now()
);

select is(received_event, duplicate_event, 'webhook duplicado devolve o evento original') from phase3_ids;
select is(
  public.processar_evento_gateway((select received_event from phase3_ids)),
  'processed',
  'PAYMENT_RECEIVED é processado'
);
select is(
  public.processar_evento_gateway((select received_event from phase3_ids)),
  'processed',
  'reprocessar evento concluído é idempotente'
);
select is(
  (select count(*)::integer from public.financial_journals where journal_type = 'payment_received'),
  1,
  'evento duplicado gera um único diário de recebimento'
);
select is(
  (
    select coalesce(sum(amount) filter (where direction = 'debit'), 0)
      - coalesce(sum(amount) filter (where direction = 'credit'), 0)
      from public.financial_postings
  ),
  0.00::numeric,
  'partidas do recebimento permanecem balanceadas'
);
select is(
  (select payment_status from public.orders where id = '30000000-0000-0000-0000-000000000001'),
  'pago',
  'projeção legada vira pago somente após liquidação'
);

-- Evento antigo e mais fraco não pode regredir RECEIVED para CONFIRMED.
update phase3_ids set confirmed_event = public.registrar_evento_gateway(
  'asaas', 'evt_confirmed_late_001', 'PAYMENT_CONFIRMED', 'pay_asaas_001', 100,
  '{"event":"PAYMENT_CONFIRMED"}'::jsonb, now() - interval '5 minutes'
);
select is(
  public.processar_evento_gateway((select confirmed_event from phase3_ids)),
  'processed',
  'evento atrasado conhecido é aceito sem erro'
);
select is(
  (select status from public.payment_charges where id = (select first_charge from phase3_ids)),
  'received',
  'evento fora de ordem não regride cobrança liquidada'
);

update phase3_ids set refund_event = public.registrar_evento_gateway(
  'asaas', 'evt_refunded_001', 'PAYMENT_REFUNDED', 'pay_asaas_001', 100,
  '{"event":"PAYMENT_REFUNDED"}'::jsonb, now()
);
select is(
  public.processar_evento_gateway((select refund_event from phase3_ids)),
  'processed',
  'reembolso integral cria reversão'
);
select is(
  (select count(*)::integer from public.financial_journals where journal_type = 'payment_reversed'),
  1,
  'existe uma única reversão do recebimento'
);
select is(
  (
    select coalesce(sum(case when direction = 'debit' then amount else -amount end), 0)
      from public.financial_postings
  ),
  0.00::numeric,
  'recebimento e reversão zeram o efeito contábil agregado'
);
select is(
  (select payment_status from public.orders where id = '30000000-0000-0000-0000-000000000001'),
  'reembolsado',
  'projeção legada acompanha o reembolso integral'
);

select throws_ok(
  format(
    'update public.financial_journals set description = %L where id = %L::uuid',
    'tentativa de edição',
    (select id from public.financial_journals limit 1)
  ),
  'P0001',
  'Registro financeiro imutável: correções exigem lançamento de reversão.',
  'diário financeiro não pode ser editado'
);

update phase3_ids set reconciliation_run = public.reconciliar_financeiro();
select is(
  (select status from public.financial_reconciliation_runs where id = (select reconciliation_run from phase3_ids)),
  'completed',
  'reconciliação interna conclui'
);
select is(
  (select divergence_count from public.financial_reconciliation_runs where id = (select reconciliation_run from phase3_ids)),
  0,
  'fluxo íntegro termina sem divergência'
);

select * from finish();
rollback;
