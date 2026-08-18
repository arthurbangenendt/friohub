begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(15);

select ok(
  not has_function_privilege('authenticated', 'public.cancelar_assinatura(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.cancelar_assinatura(uuid)', 'execute'),
  'somente backend confiável cancela assinatura'
);
select ok(
  not has_function_privilege('authenticated', 'public.assinatura_pendente_para_trocar(uuid,uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.assinatura_pendente_para_trocar(uuid,uuid,text)', 'execute'),
  'somente backend confiável consulta fatura pendente para trocar'
);
select ok(
  has_function_privilege('authenticated', 'public.minha_assinatura_atual()', 'execute')
  and not has_function_privilege('anon', 'public.minha_assinatura_atual()', 'execute'),
  'profissional logado lê a própria assinatura; anônimo não'
);

-- Fixture mínima, toda dentro da transação revertida ao final.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro-cancela@teste.local', '', now(), now());
update public.profiles set role = 'profissional', nome = 'Profissional Cancela'
 where id = '50000000-0000-0000-0000-000000000001';
insert into public.professionals (id, tipo, cidade, estado, verification_status)
values ('50000000-0000-0000-0000-000000000001', 'autonomo', 'São Paulo', 'SP', 'verificado');
update public.city_billing_config set cobranca_ativa = true where cidade = 'São Paulo';

create temporary table plan_ids (
  plan_essencial uuid,
  plan_profissional uuid
) on commit drop;
insert into plan_ids
select
  (select id from public.subscription_plans where slug = 'essencial'),
  (select id from public.subscription_plans where slug = 'profissional');

-- ---------------------------------------------------------------------------
-- Cenário 1: cancelar antes de pagar (pending_first_payment) — hard cancel,
-- devolve o gateway_payment_id da fatura para a Edge Function cancelar no Asaas.
-- ---------------------------------------------------------------------------
create temporary table c1_ids (
  subscription_id uuid,
  charge_id uuid
) on commit drop;
insert into c1_ids default values;

update c1_ids set subscription_id = public.preparar_assinatura_plano(
  '50000000-0000-0000-0000-000000000001', (select plan_essencial from plan_ids), 'mensal'
);
update c1_ids set charge_id = public.preparar_cobranca_assinatura(
  (select subscription_id from c1_ids), 'asaas', 'UNDEFINED', 'cancela-charge-1'
);
select public.vincular_cobranca_gateway(
  (select charge_id from c1_ids), 'pay_cancela_001', 'https://sandbox.asaas.com/i/cancela001', current_date + 3
);

select is(
  public.assinatura_pendente_para_trocar(
    '50000000-0000-0000-0000-000000000001', (select plan_profissional from plan_ids), 'mensal'
  ),
  'pay_cancela_001',
  'plano diferente do pendente aponta a fatura para cancelar no Asaas'
);
select is(
  public.assinatura_pendente_para_trocar(
    '50000000-0000-0000-0000-000000000001', (select plan_essencial from plan_ids), 'mensal'
  ),
  null,
  'mesmo plano do pendente não pede cancelamento'
);

select is(
  public.cancelar_assinatura('50000000-0000-0000-0000-000000000001'),
  'pay_cancela_001',
  'cancelar antes de pagar devolve o gateway_payment_id da fatura vinculada'
);
select is(
  (select status from public.plan_subscriptions where id = (select subscription_id from c1_ids)),
  'cancelled',
  'assinatura sem pagamento é cancelada na hora'
);
select is(
  (select status from public.payment_charges where id = (select charge_id from c1_ids)),
  'cancelled',
  'a fatura pendente é cancelada junto'
);

-- ---------------------------------------------------------------------------
-- Cenário 2: cancelar já ativo (pagou o ciclo) — soft cancel, mantém acesso
-- até next_due_date, não devolve fatura (nada pendente para cancelar).
-- ---------------------------------------------------------------------------
create temporary table c2_ids (
  subscription_id uuid,
  charge_id uuid,
  received_event uuid
) on commit drop;
insert into c2_ids default values;

update c2_ids set subscription_id = public.preparar_assinatura_plano(
  '50000000-0000-0000-0000-000000000001', (select plan_essencial from plan_ids), 'mensal'
);
update c2_ids set charge_id = public.preparar_cobranca_assinatura(
  (select subscription_id from c2_ids), 'asaas', 'UNDEFINED', 'cancela-charge-2'
);
select public.vincular_cobranca_gateway(
  (select charge_id from c2_ids), 'pay_cancela_002', 'https://sandbox.asaas.com/i/cancela002', current_date + 3
);
update c2_ids set received_event = public.registrar_evento_gateway(
  'asaas', 'evt_cancela_received_001', 'PAYMENT_RECEIVED', 'pay_cancela_002', 50,
  '{"event":"PAYMENT_RECEIVED"}'::jsonb, now()
);
select public.processar_evento_gateway((select received_event from c2_ids));

select is(
  (select status from public.plan_subscriptions where id = (select subscription_id from c2_ids)),
  'active',
  'assinatura fica active após liquidar (pré-condição do cenário 2)'
);

select is(
  public.cancelar_assinatura('50000000-0000-0000-0000-000000000001'),
  null,
  'cancelar assinatura já paga não devolve fatura (nada pendente)'
);
select is(
  (select status from public.plan_subscriptions where id = (select subscription_id from c2_ids)),
  'active',
  'assinatura ativa mantém o status — acesso continua até next_due_date'
);
select is(
  (select auto_renova from public.plan_subscriptions where id = (select subscription_id from c2_ids)),
  false,
  'auto_renova desliga, é o que registra o pedido de cancelamento'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro-sem-assinatura@teste.local', '', now(), now());
update public.profiles set role = 'profissional', nome = 'Profissional Sem Assinatura'
 where id = '50000000-0000-0000-0000-000000000002';
insert into public.professionals (id, tipo, cidade, estado, verification_status)
values ('50000000-0000-0000-0000-000000000002', 'autonomo', 'São Paulo', 'SP', 'verificado');

select throws_ok(
  format('select public.cancelar_assinatura(%L::uuid)', '50000000-0000-0000-0000-000000000002'),
  'P0001',
  'Nenhuma assinatura para cancelar.',
  'cancelar sem nenhuma assinatura em jogo é recusado com mensagem clara'
);

-- ---------------------------------------------------------------------------
-- Leitura própria: minha_assinatura_atual() respeita auth.uid().
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000001', true);

select is(
  (select plano_slug from public.minha_assinatura_atual()),
  'essencial',
  'o profissional lê a própria assinatura vigente'
);
select is(
  (select auto_renova from public.minha_assinatura_atual()),
  false,
  'a leitura própria reflete o cancelamento agendado'
);

reset role;

select * from finish();
rollback;
