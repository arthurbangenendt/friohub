begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

select ok(
  not has_function_privilege('authenticated', 'public.preparar_upgrade_assinatura(uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.preparar_upgrade_assinatura(uuid,uuid)', 'execute'),
  'somente backend confiável prepara upgrade'
);
select ok(
  not has_function_privilege('authenticated', 'public.solicitar_downgrade_assinatura(uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.solicitar_downgrade_assinatura(uuid,uuid)', 'execute'),
  'somente backend confiável registra downgrade'
);

-- Índice corrigido: uma assinatura pode acumular mais de uma cobrança
-- RECEIVED ao longo da vida (upgrade, ciclos futuros) — só cobranças ainda
-- em aberto precisam ser exclusivas.
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'payment_charges'
       and indexname = 'uq_payment_charges_active_subscription'
       and indexdef not ilike '%received%'
  ),
  'received não bloqueia mais uma segunda cobrança da mesma assinatura'
);

-- Fixture mínima, toda dentro da transação revertida ao final.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro-upgrade@teste.local', '', now(), now());
update public.profiles set role = 'profissional', nome = 'Profissional Upgrade'
 where id = '60000000-0000-0000-0000-000000000001';
insert into public.professionals (id, tipo, cidade, estado, verification_status)
values ('60000000-0000-0000-0000-000000000001', 'autonomo', 'São Paulo', 'SP', 'verificado');
update public.city_billing_config set cobranca_ativa = true where cidade = 'São Paulo';

create temporary table plan_ids (
  plan_essencial uuid,
  plan_profissional uuid,
  plan_master uuid
) on commit drop;
insert into plan_ids select
  (select id from public.subscription_plans where slug = 'essencial'),
  (select id from public.subscription_plans where slug = 'profissional'),
  (select id from public.subscription_plans where slug = 'master');

-- Assina o Essencial (R$50/mês) e liquida, para ter uma assinatura active de
-- verdade com next_due_date no futuro — pré-condição de upgrade.
create temporary table sub_ids (
  subscription_id uuid,
  charge_id uuid,
  upgrade_charge_id uuid,
  received_event uuid,
  upgrade_event uuid
) on commit drop;
insert into sub_ids default values;

update sub_ids set subscription_id = public.preparar_assinatura_plano(
  '60000000-0000-0000-0000-000000000001', (select plan_essencial from plan_ids), 'mensal'
);
update sub_ids set charge_id = public.preparar_cobranca_assinatura(
  (select subscription_id from sub_ids), 'asaas', 'UNDEFINED', 'upgrade-teste-charge-1'
);
select public.vincular_cobranca_gateway(
  (select charge_id from sub_ids), 'pay_upgrade_base_001', 'https://sandbox.asaas.com/i/upgradebase001', current_date + 30
);
update sub_ids set received_event = public.registrar_evento_gateway(
  'asaas', 'evt_upgrade_base_received', 'PAYMENT_RECEIVED', 'pay_upgrade_base_001', 50,
  '{"event":"PAYMENT_RECEIVED"}'::jsonb, now()
);
select public.processar_evento_gateway((select received_event from sub_ids));

-- Congela next_due_date em 15 dias no futuro para o cálculo do proporcional
-- ser determinístico no teste (30 dias de ciclo, metade do caminho).
update public.plan_subscriptions
   set next_due_date = current_date + 15
 where id = (select subscription_id from sub_ids);

-- ---------------------------------------------------------------------------
-- Upgrade: Essencial (R$50) -> Profissional (R$100), 15 de 30 dias restantes.
-- Diferença = (100-50) * 15/30 = 25.00
-- ---------------------------------------------------------------------------
select throws_ok(
  format(
    'select public.preparar_upgrade_assinatura(%L::uuid, %L::uuid)',
    '60000000-0000-0000-0000-000000000001', (select plan_essencial from plan_ids)
  ),
  'P0001',
  'Isto não é upgrade — o plano escolhido não é mais caro que o atual.',
  'pedir o mesmo plano como upgrade é recusado'
);

update sub_ids set upgrade_charge_id = public.preparar_upgrade_assinatura(
  '60000000-0000-0000-0000-000000000001', (select plan_profissional from plan_ids)
);
select is(
  (select amount from public.payment_charges where id = (select upgrade_charge_id from sub_ids)),
  25.00::numeric,
  'a cobrança de upgrade calcula a diferença proporcional aos dias restantes'
);
select is(
  (select plano_alvo_id from public.payment_charges where id = (select upgrade_charge_id from sub_ids)),
  (select plan_profissional from plan_ids),
  'a cobrança de upgrade marca o plano alvo'
);
select is(
  (select plan_id from public.plan_subscriptions where id = (select subscription_id from sub_ids)),
  (select plan_essencial from plan_ids),
  'o plano só troca quando a cobrança do upgrade liquidar, não antes'
);

select public.vincular_cobranca_gateway(
  (select upgrade_charge_id from sub_ids), 'pay_upgrade_delta_001', 'https://sandbox.asaas.com/i/upgradedelta001', current_date + 3
);
update sub_ids set upgrade_event = public.registrar_evento_gateway(
  'asaas', 'evt_upgrade_delta_received', 'PAYMENT_RECEIVED', 'pay_upgrade_delta_001', 25,
  '{"event":"PAYMENT_RECEIVED"}'::jsonb, now()
);
select is(
  public.processar_evento_gateway((select upgrade_event from sub_ids)),
  'processed',
  'a cobrança do upgrade é processada sem erro'
);
select is(
  (select plan_id from public.plan_subscriptions where id = (select subscription_id from sub_ids)),
  (select plan_profissional from plan_ids),
  'o plano troca para o Profissional após liquidar o upgrade'
);
select is(
  (select amount from public.plan_subscriptions where id = (select subscription_id from sub_ids)),
  100.00::numeric,
  'o valor da assinatura vira o preço cheio do novo plano, para o próximo ciclo'
);
select is(
  (select next_due_date from public.plan_subscriptions where id = (select subscription_id from sub_ids)),
  (current_date + 15),
  'o vencimento não muda — upgrade é ajuste do período corrente, não um novo ciclo'
);
select is(
  (select subscription_plan_id from public.professionals where id = '60000000-0000-0000-0000-000000000001'),
  (select plan_profissional from plan_ids),
  'o profissional reflete o plano novo depois do upgrade'
);

-- ---------------------------------------------------------------------------
-- Downgrade: Profissional (R$100) -> Essencial (R$50) — sem cobrança, só
-- registra a intenção para o próximo vencimento.
-- ---------------------------------------------------------------------------
select throws_ok(
  format(
    'select public.solicitar_downgrade_assinatura(%L::uuid, %L::uuid)',
    '60000000-0000-0000-0000-000000000001', (select plan_master from plan_ids)
  ),
  'P0001',
  'Isto não é downgrade — o plano escolhido não é mais barato que o atual.',
  'pedir plano mais caro como downgrade é recusado'
);

select lives_ok(
  format(
    'select public.solicitar_downgrade_assinatura(%L::uuid, %L::uuid)',
    '60000000-0000-0000-0000-000000000001', (select plan_essencial from plan_ids)
  ),
  'downgrade é aceito sem cobrança'
);
select is(
  (select plan_id from public.plan_subscriptions where id = (select subscription_id from sub_ids)),
  (select plan_profissional from plan_ids),
  'o plano vigente não muda na hora — downgrade só vale no próximo vencimento'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-0000-0000-000000000001', true);
select is(
  (select proximo_plano_slug from public.minha_assinatura_atual()),
  'essencial',
  'a leitura própria mostra o downgrade agendado'
);
reset role;

select * from finish();
rollback;
