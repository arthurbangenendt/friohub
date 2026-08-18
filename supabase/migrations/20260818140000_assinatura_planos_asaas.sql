-- ============================================================================
-- ASSINATURA DE PLANO — cobrança recorrente do profissional via Asaas
-- ============================================================================
--
-- A fundação financeira (20260813172401) foi desenhada em torno de `orders`:
-- toda `payment_charge` cobrava um serviço e rateava entre profissional,
-- distribuidora e plataforma. Assinatura de plano não tem `order` — é o
-- profissional pagando a própria plataforma, sem rateio nenhum.
--
-- Em vez de duplicar ledger/webhook/reconciliação para um segundo trilho,
-- esta migration generaliza o existente: `payment_charges` e
-- `financial_journals` passam a aceitar OU uma order OU uma assinatura
-- (nunca as duas, nunca nenhuma). O rateio de assinatura é uma alocação
-- única (`platform_subscription_revenue`, sem beneficiário) — a plataforma é
-- a única parte.
--
-- Desenho de cobrança: NÃO usamos o recurso nativo "Subscription" do Asaas
-- (que geraria pagamentos sozinho, fora do nosso controle de idempotência).
-- Cada ciclo é uma `payment_charge` avulsa que O NOSSO backend cria
-- explicitamente — mesmo padrão de `preparar_cobranca_order`, só que a
-- geração do próximo ciclo é responsabilidade de um worker futuro
-- (equivalente ao `chatwoot-dispatch`), ainda não construído nesta migration.
-- `plan_subscriptions` é o compromisso; `payment_charges` é cada tentativa.

set lock_timeout = '5s';
set statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 1. O compromisso de assinatura
-- ---------------------------------------------------------------------------
create table public.plan_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals (id) on delete restrict,
  plan_id         uuid not null references public.subscription_plans (id) on delete restrict,
  ciclo           text not null check (ciclo in ('mensal', 'anual')),
  status          text not null default 'pending_first_payment' check (status in (
    'pending_first_payment', 'active', 'overdue', 'cancelled'
  )),
  amount          numeric(12,2) not null check (amount > 0),
  next_due_date   date,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.plan_subscriptions is
  'Compromisso de assinatura do profissional. Cada cobrança de fato é uma payment_charge própria — não há recurso nativo de assinatura do gateway aqui.';
comment on column public.plan_subscriptions.status is
  'pending_first_payment até a 1a cobrança liquidar; active enquanto em dia; overdue após PAYMENT_OVERDUE; cancelled é terminal.';

-- Só uma assinatura "em jogo" por profissional — cancelar libera reassinar.
create unique index uq_plan_subscriptions_active_professional
  on public.plan_subscriptions (professional_id)
  where status in ('pending_first_payment', 'active', 'overdue');

create index idx_plan_subscriptions_due
  on public.plan_subscriptions (next_due_date)
  where status in ('active', 'overdue');

alter table public.plan_subscriptions enable row level security;
create policy "plan_subscriptions_self_read"
  on public.plan_subscriptions for select to authenticated
  using (professional_id = (select auth.uid()) or (select public.eh_admin()));
grant select on public.plan_subscriptions to authenticated;
revoke insert, update, delete on public.plan_subscriptions from anon, authenticated;
create trigger trg_plan_subscriptions_touch
  before update on public.plan_subscriptions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. `payment_charges` e `financial_journals` passam a aceitar assinatura
-- ---------------------------------------------------------------------------
alter table public.payment_charges
  alter column order_id drop not null,
  add column subscription_id uuid references public.plan_subscriptions (id) on delete restrict,
  add constraint payment_charges_order_xor_subscription
    check (num_nonnulls(order_id, subscription_id) = 1);

-- Índices parciais ignoram NULL por linha, então a unicidade de order_id
-- (20260813172401) continua correta sem tocar nela; só falta o par para
-- subscription_id.
create unique index uq_payment_charges_active_subscription
  on public.payment_charges (subscription_id)
  where status in ('pending_creation', 'pending', 'confirmed', 'received', 'overdue', 'partially_refunded', 'disputed');

alter table public.financial_journals
  alter column order_id drop not null,
  add column subscription_id uuid references public.plan_subscriptions (id) on delete restrict,
  add constraint financial_journals_order_xor_subscription
    check (num_nonnulls(order_id, subscription_id) = 1);

create index idx_financial_journals_subscription
  on public.financial_journals (subscription_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- 3. Nova conta e novo tipo de alocação: a plataforma é a única parte
-- ---------------------------------------------------------------------------
insert into public.financial_accounts (code, name, account_type) values
  ('platform_subscription_revenue', 'Receita de assinatura de profissional', 'revenue');

alter table public.payment_allocations
  drop constraint payment_allocations_allocation_type_check,
  add constraint payment_allocations_allocation_type_check
    check (allocation_type in (
      'professional_payable', 'distributor_payable',
      'platform_commission', 'platform_product_margin',
      'platform_subscription_revenue'
    ));

-- ---------------------------------------------------------------------------
-- 4. `registrar_lancamento_financeiro` aprende a assinatura
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE aceita parâmetro novo desde que venha ao final com
-- default: chamadas existentes (8 ou 9 posicionais) continuam válidas.
create or replace function public.registrar_lancamento_financeiro(
  p_order_id uuid,
  p_charge_id uuid,
  p_journal_type text,
  p_idempotency_key text,
  p_external_event_id text,
  p_description text,
  p_occurred_at timestamptz,
  p_lines jsonb,
  p_reversal_of uuid default null,
  p_subscription_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_journal_id uuid;
  v_debits numeric(14,2);
  v_credits numeric(14,2);
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'Lançamento financeiro exige ao menos duas linhas.';
  end if;

  select
    coalesce(sum((line->>'amount')::numeric) filter (where line->>'direction' = 'debit'), 0),
    coalesce(sum((line->>'amount')::numeric) filter (where line->>'direction' = 'credit'), 0)
    into v_debits, v_credits
    from jsonb_array_elements(p_lines) line;

  if v_debits <= 0 or v_debits <> v_credits then
    raise exception 'Lançamento desbalanceado: débitos %, créditos %.', v_debits, v_credits;
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) line
     where line->>'direction' not in ('debit', 'credit')
        or coalesce((line->>'amount')::numeric, 0) <= 0
        or not exists (
          select 1 from public.financial_accounts a
           where a.code = line->>'account_code' and a.active
        )
  ) then
    raise exception 'Uma ou mais linhas do lançamento são inválidas.';
  end if;

  insert into public.financial_journals (
    order_id, subscription_id, charge_id, journal_type, idempotency_key, external_event_id,
    reversal_of, description, occurred_at
  ) values (
    p_order_id, p_subscription_id, p_charge_id, p_journal_type, p_idempotency_key,
    p_external_event_id, p_reversal_of, p_description, coalesce(p_occurred_at, now())
  )
  on conflict (idempotency_key) do nothing
  returning id into v_journal_id;

  if v_journal_id is null then
    select id into v_journal_id from public.financial_journals
     where idempotency_key = p_idempotency_key;
    return v_journal_id;
  end if;

  insert into public.financial_postings (
    journal_id, account_code, direction, amount, beneficiary_id
  )
  select
    v_journal_id,
    line->>'account_code',
    line->>'direction',
    round((line->>'amount')::numeric, 2),
    nullif(line->>'beneficiary_id', '')::uuid
  from jsonb_array_elements(p_lines) line;

  return v_journal_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Preparação idempotente de uma assinatura e de cada cobrança de ciclo
-- ---------------------------------------------------------------------------
create or replace function public.preparar_assinatura_plano(
  p_professional_id uuid,
  p_plan_id uuid,
  p_ciclo text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.subscription_plans%rowtype;
  v_amount numeric(12,2);
  v_existing_id uuid;
  v_id uuid;
  v_cidade text;
  v_cobranca_ativa boolean;
begin
  if p_ciclo not in ('mensal', 'anual') then raise exception 'Ciclo inválido.'; end if;

  select id into v_existing_id from public.plan_subscriptions
   where professional_id = p_professional_id
     and status in ('pending_first_payment', 'active', 'overdue');
  if v_existing_id is not null then return v_existing_id; end if;

  -- [RISCO 1, 20260813190000] O kill switch por cidade é a decisão de negócio
  -- de quando cobrar de verdade. Checar só na UI não protege nada — quem
  -- chama a Edge Function direto contornaria. A trava vive aqui, na única
  -- porta de entrada de uma nova assinatura.
  select cidade into v_cidade from public.professionals where id = p_professional_id;
  select cobranca_ativa into v_cobranca_ativa from public.city_billing_config where cidade = v_cidade;
  if not coalesce(v_cobranca_ativa, false) then
    raise exception 'Cobrança ainda não está ativa para a sua cidade.';
  end if;

  select * into v_plan from public.subscription_plans
   where id = p_plan_id and ativo and publico;
  if not found then raise exception 'Plano indisponível.'; end if;

  v_amount := case p_ciclo when 'mensal' then v_plan.preco_mensal else v_plan.preco_anual end;
  if v_amount is null or v_amount <= 0 then raise exception 'Plano sem preço para este ciclo.'; end if;

  insert into public.plan_subscriptions (professional_id, plan_id, ciclo, amount)
  values (p_professional_id, p_plan_id, p_ciclo, v_amount)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.preparar_assinatura_plano(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.preparar_assinatura_plano(uuid, uuid, text)
  to service_role;

-- Mesmo espírito de `preparar_cobranca_order`: cria a cobrança do ciclo,
-- congela o valor, e a alocação inteira vai para a plataforma.
create or replace function public.preparar_cobranca_assinatura(
  p_subscription_id uuid,
  p_gateway text,
  p_billing_type text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.plan_subscriptions%rowtype;
  v_charge_id uuid;
  v_existing_sub_id uuid;
begin
  if p_gateway <> 'asaas' then raise exception 'Gateway não suportado.'; end if;
  if p_billing_type not in ('UNDEFINED', 'PIX', 'BOLETO', 'CREDIT_CARD') then
    raise exception 'Forma de pagamento inválida.';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Chave de idempotência obrigatória.';
  end if;

  select * into v_sub from public.plan_subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'Assinatura não encontrada.'; end if;
  if v_sub.status = 'cancelled' then raise exception 'Assinatura cancelada não aceita cobrança.'; end if;
  -- 'active' só cobra de novo pelo worker de renovação (ver comentário no
  -- topo do arquivo) — aqui é a entrada manual do profissional, que não deve
  -- gerar cobrança fora de ciclo para quem já está em dia.
  if v_sub.status = 'active' then
    raise exception 'Assinatura já está ativa; a próxima cobrança é automática no vencimento.';
  end if;

  v_charge_id := gen_random_uuid();
  insert into public.payment_charges (
    id,
    subscription_id, customer_id, gateway, idempotency_key, external_reference,
    billing_type, amount
  ) values (
    v_charge_id,
    v_sub.id, v_sub.professional_id, p_gateway, btrim(p_idempotency_key),
    format('subscription:%s:%s', v_sub.id, md5(btrim(p_idempotency_key))),
    p_billing_type, v_sub.amount
  )
  on conflict (gateway, idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning id, subscription_id into v_charge_id, v_existing_sub_id;

  if v_existing_sub_id is distinct from v_sub.id then
    raise exception 'Chave de idempotência já pertence a outra assinatura.';
  end if;

  insert into public.payment_allocations (charge_id, allocation_type, beneficiary_id, amount)
  values (v_charge_id, 'platform_subscription_revenue', null, v_sub.amount)
  on conflict (charge_id, allocation_type) do nothing;

  return v_charge_id;
end;
$$;

revoke all on function public.preparar_cobranca_assinatura(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.preparar_cobranca_assinatura(uuid, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. `processar_evento_gateway` aprende a liquidar assinatura
-- ---------------------------------------------------------------------------
create or replace function public.processar_evento_gateway(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.payment_gateway_events%rowtype;
  v_charge public.payment_charges%rowtype;
  v_lines jsonb;
  v_receipt_id uuid;
  v_result text;
  v_next_due date;
begin
  select * into v_event from public.payment_gateway_events
   where id = p_event_id for update;
  if not found then raise exception 'Evento não encontrado.'; end if;
  if v_event.processing_status in ('processed', 'ignored') then
    return v_event.processing_status;
  end if;

  update public.payment_gateway_events
     set attempts = attempts + 1, last_error = null
   where id = v_event.id;

  select * into v_charge from public.payment_charges
   where gateway = v_event.gateway
     and gateway_payment_id = v_event.gateway_payment_id
   for update;

  if not found then
    update public.payment_gateway_events
       set processing_status = 'error', last_error = 'Cobrança ainda não vinculada.'
     where id = v_event.id;
    return 'error';
  end if;

  -- Eventos conhecidos nunca podem regredir um estado terminal mais forte.
  case v_event.event_type
    when 'PAYMENT_CREATED' then
      if v_charge.status = 'pending_creation' then
        update public.payment_charges set status = 'pending' where id = v_charge.id;
      end if;

    when 'PAYMENT_UPDATED' then
      null;

    when 'PAYMENT_CONFIRMED' then
      if v_charge.status in ('pending_creation', 'pending', 'overdue') then
        update public.payment_charges
           set status = 'confirmed', confirmed_at = coalesce(confirmed_at, v_event.occurred_at)
         where id = v_charge.id;
      end if;

    when 'PAYMENT_RECEIVED' then
      if v_event.amount is not null and v_event.amount <> v_charge.amount then
        update public.payment_gateway_events
           set processing_status = 'error',
               last_error = format('Valor divergente: esperado %s, recebido %s.', v_charge.amount, v_event.amount)
         where id = v_event.id;
        return 'error';
      end if;

      select jsonb_agg(jsonb_build_object(
        'account_code', case allocation_type
          when 'professional_payable' then 'professional_payable'
          when 'distributor_payable' then 'distributor_payable'
          when 'platform_commission' then 'platform_commission'
          when 'platform_product_margin' then 'platform_product_margin'
          when 'platform_subscription_revenue' then 'platform_subscription_revenue'
        end,
        'direction', 'credit',
        'amount', amount,
        'beneficiary_id', beneficiary_id
      )) filter (where amount > 0)
      into v_lines
      from public.payment_allocations where charge_id = v_charge.id;

      v_lines := jsonb_build_array(jsonb_build_object(
        'account_code', 'gateway_clearing',
        'direction', 'debit',
        'amount', v_charge.amount
      )) || coalesce(v_lines, '[]'::jsonb);

      perform public.registrar_lancamento_financeiro(
        v_charge.order_id, v_charge.id, 'payment_received',
        format('gateway-received:%s:%s', v_event.gateway, v_charge.gateway_payment_id),
        v_event.gateway_event_id, 'Pagamento liquidado no gateway',
        v_event.occurred_at, v_lines, null, v_charge.subscription_id
      );

      update public.payment_charges
         set status = 'received', received_at = coalesce(received_at, v_event.occurred_at)
       where id = v_charge.id and status not in ('refunded', 'disputed');

      if v_charge.order_id is not null then
        update public.orders set payment_status = 'pago', payment_ref = v_charge.gateway_payment_id
         where id = v_charge.order_id and payment_status <> 'reembolsado';
      end if;

      if v_charge.subscription_id is not null then
        v_next_due := (v_event.occurred_at at time zone 'utc')::date
          + case (select ciclo from public.plan_subscriptions where id = v_charge.subscription_id)
              when 'anual' then interval '1 year' else interval '1 month'
            end;
        update public.plan_subscriptions
           set status = 'active', next_due_date = v_next_due
         where id = v_charge.subscription_id;
        update public.professionals
           set subscription_status = 'ativa',
               subscription_plan_id = (select plan_id from public.plan_subscriptions where id = v_charge.subscription_id)
         where id = (select professional_id from public.plan_subscriptions where id = v_charge.subscription_id);
      end if;

    when 'PAYMENT_OVERDUE' then
      if v_charge.status in ('pending', 'confirmed') then
        update public.payment_charges set status = 'overdue' where id = v_charge.id;
      end if;
      if v_charge.subscription_id is not null then
        update public.plan_subscriptions set status = 'overdue' where id = v_charge.subscription_id;
        update public.professionals set subscription_status = 'inadimplente'
         where id = (select professional_id from public.plan_subscriptions where id = v_charge.subscription_id);
      end if;

    when 'PAYMENT_DELETED', 'PAYMENT_BANK_SLIP_CANCELLED' then
      if v_charge.status in ('pending_creation', 'pending', 'confirmed', 'overdue') then
        update public.payment_charges set status = 'cancelled' where id = v_charge.id;
        if v_charge.order_id is not null then
          update public.orders set payment_status = 'falhou'
           where id = v_charge.order_id and payment_status = 'pendente';
        end if;
      end if;

    when 'PAYMENT_REFUNDED' then
      select id into v_receipt_id from public.financial_journals
       where charge_id = v_charge.id and journal_type = 'payment_received';

      if v_receipt_id is null then
        update public.payment_gateway_events
           set processing_status = 'error', last_error = 'Reembolso sem lançamento de recebimento.'
         where id = v_event.id;
        return 'error';
      end if;

      select jsonb_agg(jsonb_build_object(
        'account_code', p.account_code,
        'direction', case when p.direction = 'debit' then 'credit' else 'debit' end,
        'amount', p.amount,
        'beneficiary_id', p.beneficiary_id
      ) order by p.created_at, p.id)
      into v_lines
      from public.financial_postings p where p.journal_id = v_receipt_id;

      perform public.registrar_lancamento_financeiro(
        v_charge.order_id, v_charge.id, 'payment_reversed',
        format('gateway-refunded:%s:%s', v_event.gateway, v_charge.gateway_payment_id),
        v_event.gateway_event_id, 'Reversão integral do pagamento',
        v_event.occurred_at, v_lines, v_receipt_id, v_charge.subscription_id
      );

      update public.payment_charges
         set status = 'refunded', refunded_at = coalesce(refunded_at, v_event.occurred_at)
       where id = v_charge.id;
      if v_charge.order_id is not null then
        update public.orders set payment_status = 'reembolsado'
         where id = v_charge.order_id;
      end if;

    when 'PAYMENT_PARTIALLY_REFUNDED' then
      update public.payment_charges set status = 'partially_refunded' where id = v_charge.id;
      update public.payment_gateway_events
         set processing_status = 'error',
             last_error = 'Reembolso parcial exige política de alocação ainda não aprovada.'
       where id = v_event.id;
      return 'error';

    when 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE' then
      update public.payment_charges set status = 'disputed' where id = v_charge.id;

    else
      update public.payment_gateway_events
         set processing_status = 'ignored', processed_at = now()
       where id = v_event.id;
      return 'ignored';
  end case;

  update public.payment_charges
     set last_gateway_event_at = greatest(
       coalesce(last_gateway_event_at, '-infinity'::timestamptz), v_event.occurred_at
     )
   where id = v_charge.id;

  update public.payment_gateway_events
     set processing_status = 'processed', processed_at = now(), last_error = null
   where id = v_event.id;
  v_result := 'processed';
  return v_result;
exception when others then
  update public.payment_gateway_events
     set processing_status = 'error', attempts = attempts + 1,
         last_error = left(sqlerrm, 2000)
   where id = p_event_id;
  return 'error';
end;
$$;

revoke all on function public.processar_evento_gateway(uuid) from public, anon, authenticated;
grant execute on function public.processar_evento_gateway(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Reconciliação: divergências de assinatura entram no mesmo relatório
-- ---------------------------------------------------------------------------
create or replace function public.reconciliar_financeiro()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_checked integer;
  v_divergences integer;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('friohub:financial-reconciliation', 0)) then
    return null;
  end if;

  insert into public.financial_reconciliation_runs default values returning id into v_run_id;

  insert into public.financial_reconciliation_items (
    run_id, order_id, charge_id, divergence_type, expected_value, actual_value
  )
  select v_run_id, o.id, c.id, 'paid_without_ledger', o.total, 0
    from public.orders o
    left join public.payment_charges c on c.order_id = o.id and c.status = 'received'
   where o.payment_status = 'pago'
     and not exists (
       select 1 from public.financial_journals j
        where j.order_id = o.id and j.journal_type = 'payment_received'
     );

  insert into public.financial_reconciliation_items (
    run_id, order_id, charge_id, divergence_type, expected_value, actual_value
  )
  select v_run_id, o.id, c.id, 'received_without_paid_projection', c.amount, o.total
    from public.payment_charges c
    join public.orders o on o.id = c.order_id
   where c.status = 'received' and o.payment_status <> 'pago';

  insert into public.financial_reconciliation_items (
    run_id, order_id, charge_id, divergence_type, expected_value, actual_value
  )
  select v_run_id, c.order_id, c.id, 'amount_mismatch', o.total, c.amount
    from public.payment_charges c
    join public.orders o on o.id = c.order_id
   where c.amount <> o.total;

  -- Mesma checagem de valor para o lado de assinatura, sem depender de orders.
  insert into public.financial_reconciliation_items (
    run_id, order_id, charge_id, divergence_type, expected_value, actual_value
  )
  select v_run_id, null, c.id, 'amount_mismatch', s.amount, c.amount
    from public.payment_charges c
    join public.plan_subscriptions s on s.id = c.subscription_id
   where c.amount <> s.amount;

  insert into public.financial_reconciliation_items (
    run_id, order_id, charge_id, divergence_type, details
  )
  select v_run_id, c.order_id, c.id, 'stuck_gateway_event',
         jsonb_build_object('event_id', e.id, 'event_type', e.event_type, 'last_error', e.last_error)
    from public.payment_gateway_events e
    left join public.payment_charges c
      on c.gateway = e.gateway and c.gateway_payment_id = e.gateway_payment_id
   where e.processing_status = 'error'
     and e.received_at <= now() - interval '5 minutes';

  insert into public.financial_reconciliation_items (
    run_id, order_id, charge_id, divergence_type, details
  )
  select v_run_id, c.order_id, c.id, 'partial_refund_requires_review', '{}'::jsonb
    from public.payment_charges c where c.status = 'partially_refunded';

  insert into public.financial_reconciliation_items (
    run_id, order_id, charge_id, divergence_type, details
  )
  select v_run_id, c.order_id, c.id, 'disputed_payment', '{}'::jsonb
    from public.payment_charges c where c.status = 'disputed';

  select count(*) into v_checked from public.orders;
  select count(*) into v_divergences
    from public.financial_reconciliation_items where run_id = v_run_id;

  update public.financial_reconciliation_runs
     set status = 'completed', finished_at = now(),
         checked_records = v_checked, divergence_count = v_divergences
   where id = v_run_id;

  return v_run_id;
exception when others then
  if v_run_id is not null then
    update public.financial_reconciliation_runs
       set status = 'failed', finished_at = now(), error_message = left(sqlerrm, 2000)
     where id = v_run_id;
  end if;
  return v_run_id;
end;
$$;
