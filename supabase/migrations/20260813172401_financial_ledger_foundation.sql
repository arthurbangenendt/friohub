-- ============================================================================
-- FASE 3 — FUNDAÇÃO FINANCEIRA E CONTÁBIL
--
-- Esta migration NÃO chama gateway e NÃO movimenta dinheiro. Ela separa:
--   orders                  contrato comercial e projeção legada de status;
--   payment_charges         tentativa/cobrança no gateway;
--   payment_gateway_events  fato bruto recebido do gateway;
--   financial_journals      fato contábil imutável e balanceado;
--   financial_reconciliation_* divergências que exigem operação.
-- ============================================================================

set lock_timeout = '5s';
set statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 1. Cadastro privado do pagador e cobranças
-- ---------------------------------------------------------------------------
create table public.payment_customers (
  user_id             uuid primary key references public.profiles (id) on delete restrict,
  gateway             text not null check (gateway in ('asaas')),
  gateway_customer_id text not null,
  external_reference  text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (gateway, gateway_customer_id),
  unique (gateway, external_reference)
);

alter table public.payment_customers enable row level security;
revoke all on public.payment_customers from anon, authenticated;
create trigger trg_payment_customers_touch
  before update on public.payment_customers
  for each row execute function public.touch_updated_at();

create table public.payment_charges (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders (id) on delete restrict,
  customer_id         uuid not null references public.profiles (id) on delete restrict,
  gateway              text not null check (gateway in ('asaas')),
  gateway_payment_id   text,
  idempotency_key      text not null,
  external_reference  text not null,
  billing_type         text not null default 'UNDEFINED'
                       check (billing_type in ('UNDEFINED', 'PIX', 'BOLETO', 'CREDIT_CARD')),
  amount               numeric(12,2) not null check (amount > 0),
  currency             char(3) not null default 'BRL' check (currency = 'BRL'),
  status               text not null default 'pending_creation' check (status in (
    'pending_creation', 'pending', 'confirmed', 'received', 'overdue',
    'cancelled', 'failed', 'partially_refunded', 'refunded', 'disputed'
  )),
  checkout_url         text,
  due_date             date,
  confirmed_at         timestamptz,
  received_at          timestamptz,
  refunded_at          timestamptz,
  last_gateway_event_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (gateway, idempotency_key),
  unique (gateway, external_reference),
  unique (gateway, gateway_payment_id)
);

create unique index uq_payment_charges_active_order
  on public.payment_charges (order_id)
  where status in ('pending_creation', 'pending', 'confirmed', 'received', 'overdue', 'partially_refunded', 'disputed');
create index idx_payment_charges_customer_created
  on public.payment_charges (customer_id, created_at desc);
create index idx_payment_charges_reconciliation
  on public.payment_charges (status, updated_at)
  where status not in ('cancelled', 'failed', 'refunded');

alter table public.payment_charges enable row level security;
create policy "payment_charges_client_read"
  on public.payment_charges for select to authenticated
  using (
    customer_id = (select auth.uid())
    or (select public.eh_admin())
  );
grant select on public.payment_charges to authenticated;
revoke insert, update, delete on public.payment_charges from anon, authenticated;
create trigger trg_payment_charges_touch
  before update on public.payment_charges
  for each row execute function public.touch_updated_at();

-- Snapshot da distribuição econômica no momento em que a cobrança é preparada.
-- Alterações futuras de comissão, produto ou custo não reescrevem o passado.
create table public.payment_allocations (
  id             uuid primary key default gen_random_uuid(),
  charge_id      uuid not null references public.payment_charges (id) on delete restrict,
  allocation_type text not null check (allocation_type in (
    'professional_payable', 'distributor_payable',
    'platform_commission', 'platform_product_margin'
  )),
  beneficiary_id uuid references public.profiles (id) on delete restrict,
  amount          numeric(12,2) not null check (amount >= 0),
  created_at      timestamptz not null default now(),
  unique (charge_id, allocation_type)
);

create index idx_payment_allocations_charge on public.payment_allocations (charge_id);
alter table public.payment_allocations enable row level security;
create policy "payment_allocations_admin_read"
  on public.payment_allocations for select to authenticated
  using ((select public.eh_admin()));
grant select on public.payment_allocations to authenticated;
revoke insert, update, delete on public.payment_allocations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Ledger de partidas dobradas
-- ---------------------------------------------------------------------------
create table public.financial_accounts (
  code         text primary key,
  name         text not null,
  account_type text not null check (account_type in ('asset', 'liability', 'revenue', 'expense')),
  active       boolean not null default true
);

insert into public.financial_accounts (code, name, account_type) values
  ('gateway_clearing',          'Valores liquidados no gateway',       'asset'),
  ('professional_payable',      'A pagar a profissionais',             'liability'),
  ('distributor_payable',       'A pagar a distribuidoras',            'liability'),
  ('platform_commission',       'Receita de comissão de serviço',      'revenue'),
  ('platform_product_margin',   'Receita de margem de equipamento',    'revenue');

alter table public.financial_accounts enable row level security;
create policy "financial_accounts_admin_read"
  on public.financial_accounts for select to authenticated
  using ((select public.eh_admin()));
grant select on public.financial_accounts to authenticated;
revoke insert, update, delete on public.financial_accounts from anon, authenticated;

create table public.financial_journals (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete restrict,
  charge_id         uuid references public.payment_charges (id) on delete restrict,
  journal_type      text not null check (journal_type in ('payment_received', 'payment_reversed', 'manual_adjustment')),
  idempotency_key   text not null unique,
  external_event_id text,
  reversal_of       uuid unique references public.financial_journals (id) on delete restrict,
  description       text not null,
  occurred_at       timestamptz not null,
  posted_at         timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  check (
    (journal_type = 'payment_reversed' and reversal_of is not null)
    or (journal_type <> 'payment_reversed' and reversal_of is null)
  )
);

create index idx_financial_journals_order on public.financial_journals (order_id, occurred_at desc);
create index idx_financial_journals_charge on public.financial_journals (charge_id, occurred_at desc);

create table public.financial_postings (
  id             uuid primary key default gen_random_uuid(),
  journal_id     uuid not null references public.financial_journals (id) on delete restrict,
  account_code   text not null references public.financial_accounts (code) on delete restrict,
  direction      text not null check (direction in ('debit', 'credit')),
  amount         numeric(12,2) not null check (amount > 0),
  beneficiary_id uuid references public.profiles (id) on delete restrict,
  created_at     timestamptz not null default now()
);

create index idx_financial_postings_journal on public.financial_postings (journal_id);
create index idx_financial_postings_account on public.financial_postings (account_code, created_at desc);

alter table public.financial_journals enable row level security;
alter table public.financial_postings enable row level security;
create policy "financial_journals_admin_read"
  on public.financial_journals for select to authenticated
  using ((select public.eh_admin()));
create policy "financial_postings_admin_read"
  on public.financial_postings for select to authenticated
  using ((select public.eh_admin()));
grant select on public.financial_journals, public.financial_postings to authenticated;
revoke insert, update, delete on public.financial_journals, public.financial_postings from anon, authenticated;

create or replace function public.bloqueia_mutacao_financeira()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Registro financeiro imutável: correções exigem lançamento de reversão.';
end;
$$;

create trigger trg_financial_journals_immutable
  before update or delete on public.financial_journals
  for each row execute function public.bloqueia_mutacao_financeira();
create trigger trg_financial_postings_immutable
  before update or delete on public.financial_postings
  for each row execute function public.bloqueia_mutacao_financeira();
create trigger trg_payment_allocations_immutable
  before update or delete on public.payment_allocations
  for each row execute function public.bloqueia_mutacao_financeira();

revoke all on function public.bloqueia_mutacao_financeira() from public, anon, authenticated;

create or replace function public.registrar_lancamento_financeiro(
  p_order_id uuid,
  p_charge_id uuid,
  p_journal_type text,
  p_idempotency_key text,
  p_external_event_id text,
  p_description text,
  p_occurred_at timestamptz,
  p_lines jsonb,
  p_reversal_of uuid default null
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
    order_id, charge_id, journal_type, idempotency_key, external_event_id,
    reversal_of, description, occurred_at
  ) values (
    p_order_id, p_charge_id, p_journal_type, p_idempotency_key,
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

revoke all on function public.registrar_lancamento_financeiro(
  uuid, uuid, text, text, text, text, timestamptz, jsonb, uuid
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Preparação idempotente de uma cobrança (somente backend confiável)
-- ---------------------------------------------------------------------------
create or replace function public.preparar_cobranca_order(
  p_order_id uuid,
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
  v_order public.orders%rowtype;
  v_job public.jobs%rowtype;
  v_charge_id uuid;
  v_professional_amount numeric(12,2);
  v_distributor_amount numeric(12,2);
  v_distributor_id uuid;
  v_existing_order_id uuid;
begin
  if p_gateway <> 'asaas' then raise exception 'Gateway não suportado.'; end if;
  if p_billing_type not in ('UNDEFINED', 'PIX', 'BOLETO', 'CREDIT_CARD') then
    raise exception 'Forma de pagamento inválida.';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Chave de idempotência obrigatória.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Ordem não encontrada.'; end if;
  select * into v_job from public.jobs where id = v_order.job_id;
  if v_order.total <= 0 then raise exception 'Ordem sem valor cobravel.'; end if;
  if v_order.payment_status in ('pago', 'reembolsado') then
    raise exception 'Esta ordem não aceita nova cobrança.';
  end if;

  v_charge_id := gen_random_uuid();
  insert into public.payment_charges (
    id,
    order_id, customer_id, gateway, idempotency_key, external_reference,
    billing_type, amount
  ) values (
    v_charge_id,
    v_order.id, v_job.cliente_id, p_gateway, btrim(p_idempotency_key),
    format('order:%s:%s', v_order.id, md5(btrim(p_idempotency_key))),
    p_billing_type, v_order.total
  )
  on conflict (gateway, idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning id, order_id into v_charge_id, v_existing_order_id;

  if v_existing_order_id is distinct from v_order.id then
    raise exception 'Chave de idempotência já pertence a outra ordem.';
  end if;

  v_professional_amount := greatest(v_order.preco_servico - v_order.comissao_servico, 0);
  v_distributor_amount := greatest(v_order.preco_produto - v_order.margem_produto, 0);
  select po.distributor_id into v_distributor_id
    from public.purchase_orders po where po.order_id = v_order.id;

  insert into public.payment_allocations (charge_id, allocation_type, beneficiary_id, amount)
  values
    (v_charge_id, 'professional_payable', v_job.profissional_id, v_professional_amount),
    (v_charge_id, 'distributor_payable', v_distributor_id, v_distributor_amount),
    (v_charge_id, 'platform_commission', null, v_order.comissao_servico),
    (v_charge_id, 'platform_product_margin', null, v_order.margem_produto)
  on conflict (charge_id, allocation_type) do nothing;

  if (
    select coalesce(sum(amount), 0) <> v_order.total
      from public.payment_allocations where charge_id = v_charge_id
  ) then
    raise exception 'Distribuição financeira não fecha com o total da ordem.';
  end if;

  return v_charge_id;
end;
$$;

revoke all on function public.preparar_cobranca_order(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.preparar_cobranca_order(uuid, text, text, text)
  to service_role;

create or replace function public.vincular_cobranca_gateway(
  p_charge_id uuid,
  p_gateway_payment_id text,
  p_checkout_url text,
  p_due_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.payment_charges
     set gateway_payment_id = p_gateway_payment_id,
         checkout_url = p_checkout_url,
         due_date = p_due_date,
         status = 'pending'
   where id = p_charge_id
     and status = 'pending_creation'
     and gateway_payment_id is null;
  if not found then raise exception 'Cobrança indisponível para vinculação.'; end if;
end;
$$;

revoke all on function public.vincular_cobranca_gateway(uuid, text, text, date)
  from public, anon, authenticated;
grant execute on function public.vincular_cobranca_gateway(uuid, text, text, date)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Inbox imutável de eventos do gateway
-- ---------------------------------------------------------------------------
create table public.payment_gateway_events (
  id                  uuid primary key default gen_random_uuid(),
  gateway             text not null check (gateway in ('asaas')),
  gateway_event_id    text not null,
  event_type          text not null,
  gateway_payment_id  text,
  amount              numeric(12,2),
  payload             jsonb not null,
  occurred_at         timestamptz not null,
  received_at         timestamptz not null default now(),
  processing_status   text not null default 'pending'
                      check (processing_status in ('pending', 'processed', 'ignored', 'error')),
  attempts            integer not null default 0 check (attempts >= 0),
  processed_at        timestamptz,
  last_error          text,
  unique (gateway, gateway_event_id)
);

create index idx_payment_gateway_events_pending
  on public.payment_gateway_events (received_at)
  where processing_status in ('pending', 'error');
create index idx_payment_gateway_events_payment
  on public.payment_gateway_events (gateway, gateway_payment_id, occurred_at);

alter table public.payment_gateway_events enable row level security;
create policy "payment_gateway_events_admin_read"
  on public.payment_gateway_events for select to authenticated
  using ((select public.eh_admin()));
grant select on public.payment_gateway_events to authenticated;
revoke insert, update, delete on public.payment_gateway_events from anon, authenticated;

create trigger trg_payment_gateway_events_immutable
  before delete on public.payment_gateway_events
  for each row execute function public.bloqueia_mutacao_financeira();

create or replace function public.registrar_evento_gateway(
  p_gateway text,
  p_gateway_event_id text,
  p_event_type text,
  p_gateway_payment_id text,
  p_amount numeric,
  p_payload jsonb,
  p_occurred_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_gateway <> 'asaas' then raise exception 'Gateway não suportado.'; end if;
  if nullif(btrim(p_gateway_event_id), '') is null then raise exception 'Evento sem identificador.'; end if;

  insert into public.payment_gateway_events (
    gateway, gateway_event_id, event_type, gateway_payment_id,
    amount, payload, occurred_at
  ) values (
    p_gateway, btrim(p_gateway_event_id), p_event_type,
    nullif(btrim(p_gateway_payment_id), ''), p_amount,
    coalesce(p_payload, '{}'::jsonb), coalesce(p_occurred_at, now())
  )
  on conflict (gateway, gateway_event_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.payment_gateway_events
     where gateway = p_gateway and gateway_event_id = btrim(p_gateway_event_id);
  end if;
  return v_id;
end;
$$;

revoke all on function public.registrar_evento_gateway(
  text, text, text, text, numeric, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.registrar_evento_gateway(
  text, text, text, text, numeric, jsonb, timestamptz
) to service_role;

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
        v_event.occurred_at, v_lines, null
      );

      update public.payment_charges
         set status = 'received', received_at = coalesce(received_at, v_event.occurred_at)
       where id = v_charge.id and status not in ('refunded', 'disputed');
      update public.orders set payment_status = 'pago', payment_ref = v_charge.gateway_payment_id
       where id = v_charge.order_id and payment_status <> 'reembolsado';

    when 'PAYMENT_OVERDUE' then
      if v_charge.status in ('pending', 'confirmed') then
        update public.payment_charges set status = 'overdue' where id = v_charge.id;
      end if;

    when 'PAYMENT_DELETED', 'PAYMENT_BANK_SLIP_CANCELLED' then
      if v_charge.status in ('pending_creation', 'pending', 'confirmed', 'overdue') then
        update public.payment_charges set status = 'cancelled' where id = v_charge.id;
        update public.orders set payment_status = 'falhou'
         where id = v_charge.order_id and payment_status = 'pendente';
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
        v_event.occurred_at, v_lines, v_receipt_id
      );

      update public.payment_charges
         set status = 'refunded', refunded_at = coalesce(refunded_at, v_event.occurred_at)
       where id = v_charge.id;
      update public.orders set payment_status = 'reembolsado'
       where id = v_charge.order_id;

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

create or replace function public.processar_eventos_gateway_pendentes(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_count integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('friohub:gateway-events', 0)) then
    return 0;
  end if;

  for v_event in
    select id from public.payment_gateway_events
     where processing_status in ('pending', 'error')
       and attempts < 10
     order by received_at
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
     for update skip locked
  loop
    perform public.processar_evento_gateway(v_event.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.processar_eventos_gateway_pendentes(integer)
  from public, anon, authenticated;
grant execute on function public.processar_eventos_gateway_pendentes(integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Reconciliação interna e divergências
-- ---------------------------------------------------------------------------
create table public.financial_reconciliation_runs (
  id               uuid primary key default gen_random_uuid(),
  status           text not null default 'running' check (status in ('running', 'completed', 'failed')),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  checked_records  integer not null default 0,
  divergence_count integer not null default 0,
  error_message    text
);

create table public.financial_reconciliation_items (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references public.financial_reconciliation_runs (id) on delete cascade,
  order_id        uuid references public.orders (id) on delete restrict,
  charge_id       uuid references public.payment_charges (id) on delete restrict,
  divergence_type text not null check (divergence_type in (
    'paid_without_ledger', 'received_without_paid_projection',
    'amount_mismatch', 'stuck_gateway_event', 'partial_refund_requires_review',
    'disputed_payment'
  )),
  expected_value  numeric(12,2),
  actual_value    numeric(12,2),
  details         jsonb not null default '{}'::jsonb,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (run_id, divergence_type, order_id, charge_id)
);

create index idx_financial_reconciliation_items_open
  on public.financial_reconciliation_items (divergence_type, created_at)
  where resolved_at is null;

alter table public.financial_reconciliation_runs enable row level security;
alter table public.financial_reconciliation_items enable row level security;
create policy "financial_reconciliation_runs_admin_read"
  on public.financial_reconciliation_runs for select to authenticated
  using ((select public.eh_admin()));
create policy "financial_reconciliation_items_admin_read"
  on public.financial_reconciliation_items for select to authenticated
  using ((select public.eh_admin()));
grant select on public.financial_reconciliation_runs, public.financial_reconciliation_items to authenticated;
revoke insert, update, delete on public.financial_reconciliation_runs, public.financial_reconciliation_items
  from anon, authenticated;

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
  select v_run_id, o.id, c.id, 'amount_mismatch', o.total, c.amount
    from public.payment_charges c
    join public.orders o on o.id = c.order_id
   where c.amount <> o.total;

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

revoke all on function public.reconciliar_financeiro() from public, anon, authenticated;
grant execute on function public.reconciliar_financeiro() to service_role;

select cron.schedule(
  'friohub-financial-reconciliation',
  '17 * * * *',
  'select public.reconciliar_financeiro();'
);

-- Cliente vê apenas o estado seguro da própria cobrança, sem payload do gateway,
-- composição de margem ou identificadores internos de beneficiários.
create view public.payment_status_cliente
with (security_invoker = true) as
select
  c.id, c.order_id, c.billing_type, c.amount, c.currency, c.status,
  c.checkout_url, c.due_date, c.confirmed_at, c.received_at, c.refunded_at,
  c.created_at
from public.payment_charges c;

revoke all on public.payment_status_cliente from anon;
grant select on public.payment_status_cliente to authenticated;
