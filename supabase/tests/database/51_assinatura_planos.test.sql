begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(27);

select has_table('public', 'plan_subscriptions', 'compromisso de assinatura existe');
select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'plan_subscriptions'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ),
  'Data API não escreve diretamente em plan_subscriptions'
);
select ok(
  not has_function_privilege('authenticated', 'public.preparar_assinatura_plano(uuid,uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.preparar_assinatura_plano(uuid,uuid,text)', 'execute'),
  'somente backend confiável abre assinatura'
);
select ok(
  not has_function_privilege('authenticated', 'public.preparar_cobranca_assinatura(uuid,text,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.preparar_cobranca_assinatura(uuid,text,text,text)', 'execute'),
  'somente backend confiável prepara cobrança de assinatura'
);

-- Fixture mínima, toda dentro da transação revertida ao final.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro-assinante@teste.local', '', now(), now());

update public.profiles set role = 'profissional', nome = 'Profissional Assinante'
 where id = '40000000-0000-0000-0000-000000000001';

insert into public.professionals (id, tipo, cidade, estado, verification_status)
values ('40000000-0000-0000-0000-000000000001', 'autonomo', 'São Paulo', 'SP', 'verificado');

create temporary table plan_ids (
  plan_essencial uuid
) on commit drop;
insert into plan_ids select id from public.subscription_plans where slug = 'essencial';

-- Independente do estado real da tabela (20260818145000 ligou São Paulo para
-- o teste de sandbox), este teste verifica o comportamento com o switch
-- desligado — não pode depender de quando rodou por último.
update public.city_billing_config set cobranca_ativa = false where cidade = 'São Paulo';

select throws_ok(
  format(
    'select public.preparar_assinatura_plano(%L::uuid, %L::uuid, %L)',
    '40000000-0000-0000-0000-000000000001', (select plan_essencial from plan_ids), 'mensal'
  ),
  'P0001',
  'Cobrança ainda não está ativa para a sua cidade.',
  'kill switch por cidade bloqueia assinatura enquanto desligado'
);

-- Kill switch de cobrança por cidade (20260813190000): sem isto,
-- preparar_assinatura_plano recusa qualquer assinatura nova.
update public.city_billing_config set cobranca_ativa = true where cidade = 'São Paulo';

create temporary table sub_ids (
  subscription_id uuid,
  first_charge uuid,
  second_charge uuid,
  received_event uuid
) on commit drop;
insert into sub_ids default values;

update sub_ids set subscription_id = public.preparar_assinatura_plano(
  '40000000-0000-0000-0000-000000000001',
  (select plan_essencial from plan_ids),
  'mensal'
);

select is(
  (select status from public.plan_subscriptions where id = (select subscription_id from sub_ids)),
  'pending_first_payment',
  'assinatura nasce aguardando a primeira cobrança'
);
select is(
  public.preparar_assinatura_plano(
    '40000000-0000-0000-0000-000000000001',
    (select plan_essencial from plan_ids),
    'mensal'
  ),
  (select subscription_id from sub_ids),
  'reassinar com pendência em aberto devolve a mesma assinatura'
);

-- Mudar de ideia antes de pagar (20260818149000): pedir outro plano não pode
-- devolver a assinatura antiga com o valor errado — bug real encontrado
-- testando em produção, onde clicar em qualquer cartão sempre levava para o
-- checkout do primeiro plano escolhido.
create temporary table plan_profissional_ids (
  plan_profissional uuid
) on commit drop;
insert into plan_profissional_ids select id from public.subscription_plans where slug = 'profissional';

create temporary table troca_ids (
  nova_subscription uuid
) on commit drop;
insert into troca_ids default values;

update troca_ids set nova_subscription = public.preparar_assinatura_plano(
  '40000000-0000-0000-0000-000000000001',
  (select plan_profissional from plan_profissional_ids),
  'mensal'
);

select isnt(
  (select nova_subscription from troca_ids),
  (select subscription_id from sub_ids),
  'trocar de plano antes de pagar abre uma assinatura nova'
);
select is(
  (select status from public.plan_subscriptions where id = (select subscription_id from sub_ids)),
  'cancelled',
  'a tentativa antiga é cancelada ao trocar de plano'
);
select is(
  (select amount from public.plan_subscriptions where id = (select nova_subscription from troca_ids)),
  100.00::numeric,
  'a assinatura nova reflete o valor do plano recém-escolhido'
);

-- Volta para o essencial — o resto do teste segue sobre esta terceira
-- assinatura (a do profissional, criada acima, também fica cancelada).
update sub_ids set subscription_id = public.preparar_assinatura_plano(
  '40000000-0000-0000-0000-000000000001',
  (select plan_essencial from plan_ids),
  'mensal'
);

update sub_ids set first_charge = public.preparar_cobranca_assinatura(
  (select subscription_id from sub_ids), 'asaas', 'UNDEFINED', 'sub-charge-1'
);
update sub_ids set second_charge = public.preparar_cobranca_assinatura(
  (select subscription_id from sub_ids), 'asaas', 'UNDEFINED', 'sub-charge-1'
);
select is(first_charge, second_charge, 'preparação repetida devolve a mesma cobrança de assinatura') from sub_ids;
select is(
  (select amount from public.payment_charges where id = (select first_charge from sub_ids)),
  50.00::numeric,
  'cobrança nasce com o valor do plano essencial mensal'
);
select is(
  (select order_id from public.payment_charges where id = (select first_charge from sub_ids)),
  null,
  'cobrança de assinatura não tem order_id'
);

select lives_ok(
  format(
    'select public.vincular_cobranca_gateway(%L::uuid, %L, %L, current_date + 5)',
    (select first_charge from sub_ids), 'pay_asaas_sub_001', 'https://sandbox.asaas.com/i/sub001'
  ),
  'backend vincula a cobrança de assinatura ao id do gateway'
);

update sub_ids set received_event = public.registrar_evento_gateway(
  'asaas', 'evt_sub_received_001', 'PAYMENT_RECEIVED', 'pay_asaas_sub_001', 50,
  '{"event":"PAYMENT_RECEIVED"}'::jsonb, now()
);
select is(
  public.processar_evento_gateway((select received_event from sub_ids)),
  'processed',
  'PAYMENT_RECEIVED da assinatura é processado'
);
select is(
  (select status from public.plan_subscriptions where id = (select subscription_id from sub_ids)),
  'active',
  'assinatura vira active após liquidação'
);
select is(
  (select subscription_status from public.professionals where id = '40000000-0000-0000-0000-000000000001'),
  'ativa',
  'profissional vira ativa após liquidação da assinatura'
);
select is(
  (select subscription_plan_id from public.professionals where id = '40000000-0000-0000-0000-000000000001'),
  (select plan_essencial from plan_ids),
  'plano do profissional é vinculado após liquidação'
);
select is(
  (select next_due_date from public.plan_subscriptions where id = (select subscription_id from sub_ids)),
  (current_date + interval '1 month')::date,
  'próximo vencimento avança um ciclo mensal'
);
select is(
  (
    select coalesce(sum(amount) filter (where direction = 'debit'), 0)
      - coalesce(sum(amount) filter (where direction = 'credit'), 0)
      from public.financial_postings p
      join public.financial_journals j on j.id = p.journal_id
     where j.subscription_id = (select subscription_id from sub_ids)
  ),
  0.00::numeric,
  'lançamento de assinatura permanece balanceado'
);

-- Fallback por estado (20260818148000): cidade sem linha própria em
-- city_billing_config, mas o estado tem cobrança ligada.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro-interior@teste.local', '', now(), now());
update public.profiles set role = 'profissional', nome = 'Profissional do Interior'
 where id = '40000000-0000-0000-0000-000000000002';
insert into public.professionals (id, tipo, cidade, estado, verification_status)
values ('40000000-0000-0000-0000-000000000002', 'autonomo', 'Campinas', 'SP', 'verificado');

select throws_ok(
  format(
    'select public.preparar_assinatura_plano(%L::uuid, %L::uuid, %L)',
    '40000000-0000-0000-0000-000000000002', (select plan_essencial from plan_ids), 'mensal'
  ),
  'P0001',
  'Cobrança ainda não está ativa para a sua cidade.',
  'sem linha de cidade nem de estado, continua bloqueado'
);

update public.state_billing_config
   set cobranca_ativa = true
 where estado = 'SP';
insert into public.state_billing_config (estado, cobranca_ativa)
select 'SP', true
 where not exists (select 1 from public.state_billing_config where estado = 'SP');

select lives_ok(
  format(
    'select public.preparar_assinatura_plano(%L::uuid, %L::uuid, %L)',
    '40000000-0000-0000-0000-000000000002', (select plan_essencial from plan_ids), 'mensal'
  ),
  'estado ligado libera profissional de cidade sem linha própria'
);

-- Bug real (20260818150000): fatura de uma assinatura já CANCELADA localmente
-- (trocada de plano antes de pagar) chega como paga no Asaas mesmo assim —
-- cancelar aqui não cancela lá. Isso não pode derrubar o processamento nem
-- ressuscitar o compromisso morto, mas o dinheiro recebido é fato e tem que
-- entrar no ledger de qualquer forma.
create temporary table stale_ids (
  stale_charge uuid,
  stale_event uuid
) on commit drop;
insert into stale_ids default values;

-- `troca_ids.nova_subscription` é a assinatura do plano Profissional que foi
-- cancelada mais cedo neste teste, ao voltar para o Essencial.
update stale_ids set stale_charge = gen_random_uuid();
insert into public.payment_charges (
  id, subscription_id, customer_id, gateway, idempotency_key, external_reference,
  billing_type, amount, status, gateway_payment_id
) values (
  (select stale_charge from stale_ids),
  (select nova_subscription from troca_ids),
  '40000000-0000-0000-0000-000000000001',
  'asaas', 'sub-charge-stale', 'subscription:stale:teste',
  'UNDEFINED', 100.00, 'pending', 'pay_stale_001'
);
insert into public.payment_allocations (charge_id, allocation_type, beneficiary_id, amount)
values ((select stale_charge from stale_ids), 'platform_subscription_revenue', null, 100.00);

update stale_ids set stale_event = public.registrar_evento_gateway(
  'asaas', 'evt_stale_received_001', 'PAYMENT_RECEIVED', 'pay_stale_001', 100,
  '{"event":"PAYMENT_RECEIVED"}'::jsonb, now()
);
select lives_ok(
  format('select public.processar_evento_gateway(%L::uuid)', (select stale_event from stale_ids)),
  'PAYMENT_RECEIVED de assinatura cancelada não derruba o processamento'
);
select is(
  public.processar_evento_gateway((select stale_event from stale_ids)),
  'processed',
  'o evento termina processado, não travado em erro'
);
select is(
  (select status from public.plan_subscriptions where id = (select nova_subscription from troca_ids)),
  'cancelled',
  'a assinatura cancelada não é ressuscitada'
);
select is(
  (select subscription_plan_id from public.professionals where id = '40000000-0000-0000-0000-000000000001'),
  (select plan_essencial from plan_ids),
  'o profissional continua vinculado ao plano vigente, não ao cancelado'
);
select is(
  (
    select count(*)::integer from public.financial_journals
     where charge_id = (select stale_charge from stale_ids) and journal_type = 'payment_received'
  ),
  1,
  'o dinheiro recebido entra no ledger mesmo sem promover ninguém'
);

select * from finish();
rollback;
