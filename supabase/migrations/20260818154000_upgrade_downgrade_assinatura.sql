-- ============================================================================
-- Upgrade e downgrade de plano
-- ============================================================================
--
-- Upgrade: cobrança imediata da diferença proporcional aos dias restantes do
-- ciclo já pago. Funciona hoje, sem depender de nenhum worker — mesma lógica
-- de "nada muda até PAYMENT_RECEIVED" do resto do sistema (ADR 001, ponto 7):
-- o plano só troca de fato quando a cobrança da diferença é liquidada.
--
-- Downgrade: sem reembolso do que já foi pago (reembolso parcial está
-- bloqueado de propósito — ADR 001, ponto 9). Só registra a intenção em
-- `proximo_plano_id`; aplicar isso no vencimento é responsabilidade do worker
-- de renovação, que ainda NÃO existe. Até lá, é uma intenção marcada, não uma
-- garantia — a tela precisa deixar isso claro para o profissional.
--
-- Achado corrigindo isto: `uq_payment_charges_active_subscription`
-- (20260818140000) incluía 'received' no conjunto de status que bloqueiam
-- nova cobrança para a mesma assinatura. Isso travaria PARA SEMPRE qualquer
-- segunda cobrança da mesma assinatura — não só o upgrade de hoje, como
-- qualquer worker de renovação futuro (ciclo 2 nunca conseguiria cobrar,
-- porque o ciclo 1 já estaria 'received'). Diferente de `orders` (uma cobrança
-- só, para sempre), assinatura é recorrente por natureza: só cobranças ainda
-- EM ABERTO devem ser exclusivas; uma liquidada não impede a próxima.

drop index if exists uq_payment_charges_active_subscription;
create unique index uq_payment_charges_active_subscription
  on public.payment_charges (subscription_id)
  where status in ('pending_creation', 'pending', 'confirmed', 'overdue', 'partially_refunded', 'disputed');

alter table public.payment_charges
  add column if not exists plano_alvo_id uuid references public.subscription_plans (id);
comment on column public.payment_charges.plano_alvo_id is
  'Só preenchido em cobrança de upgrade: o plano para o qual a assinatura troca quando esta cobrança liquidar. Nulo em cobrança de ciclo normal.';

alter table public.plan_subscriptions
  add column if not exists proximo_plano_id uuid references public.subscription_plans (id);
comment on column public.plan_subscriptions.proximo_plano_id is
  'Downgrade solicitado: plano para o qual troca no próximo vencimento, sem reembolso do ciclo corrente. Só tem efeito quando o worker de renovação (ainda não construído) processar — até lá é intenção registrada, não garantia.';

-- ---------------------------------------------------------------------------
-- Upgrade: cobrança imediata da diferença proporcional
-- ---------------------------------------------------------------------------
create or replace function public.preparar_upgrade_assinatura(
  p_professional_id uuid,
  p_novo_plano_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.plan_subscriptions%rowtype;
  v_novo_valor numeric(12,2);
  v_dias_restantes integer;
  v_dias_ciclo integer;
  v_delta numeric(12,2);
  v_idempotency_key text;
  v_charge_id uuid;
  v_existing_sub_id uuid;
begin
  select * into v_sub from public.plan_subscriptions
   where professional_id = p_professional_id and status = 'active'
   for update;
  if not found then
    raise exception 'Nenhuma assinatura ativa para trocar de plano.';
  end if;
  if v_sub.next_due_date is null or v_sub.next_due_date <= current_date then
    raise exception 'Assinatura sem vencimento válido para calcular a troca. Regularize antes de trocar de plano.';
  end if;

  select case v_sub.ciclo when 'anual' then preco_anual else preco_mensal end
    into v_novo_valor
    from public.subscription_plans
   where id = p_novo_plano_id and ativo and publico;
  if v_novo_valor is null then raise exception 'Plano indisponível para este ciclo.'; end if;
  if v_novo_valor <= v_sub.amount then
    raise exception 'Isto não é upgrade — o plano escolhido não é mais caro que o atual.';
  end if;

  v_dias_restantes := v_sub.next_due_date - current_date;
  v_dias_ciclo := case v_sub.ciclo when 'anual' then 365 else 30 end;
  v_delta := round((v_novo_valor - v_sub.amount) * v_dias_restantes / v_dias_ciclo, 2);
  if v_delta <= 0 then raise exception 'Diferença calculada não é cobrável.'; end if;

  v_idempotency_key := format('upgrade:%s:%s:%s', v_sub.id, p_novo_plano_id, current_date);

  v_charge_id := gen_random_uuid();
  insert into public.payment_charges (
    id, subscription_id, customer_id, gateway, idempotency_key, external_reference,
    billing_type, amount, plano_alvo_id
  ) values (
    v_charge_id, v_sub.id, v_sub.professional_id, 'asaas', v_idempotency_key,
    format('upgrade:%s:%s', v_sub.id, md5(v_idempotency_key)),
    'UNDEFINED', v_delta, p_novo_plano_id
  )
  on conflict (gateway, idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning id, subscription_id into v_charge_id, v_existing_sub_id;

  if v_existing_sub_id is distinct from v_sub.id then
    raise exception 'Chave de idempotência já pertence a outra assinatura.';
  end if;

  insert into public.payment_allocations (charge_id, allocation_type, beneficiary_id, amount)
  values (v_charge_id, 'platform_subscription_revenue', null, v_delta)
  on conflict (charge_id, allocation_type) do nothing;

  return v_charge_id;
end;
$$;

revoke all on function public.preparar_upgrade_assinatura(uuid, uuid) from public, anon, authenticated;
grant execute on function public.preparar_upgrade_assinatura(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Downgrade: sem cobrança, sem reembolso — só registra a intenção
-- ---------------------------------------------------------------------------
create or replace function public.solicitar_downgrade_assinatura(
  p_professional_id uuid,
  p_novo_plano_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.plan_subscriptions%rowtype;
  v_novo_valor numeric(12,2);
begin
  select * into v_sub from public.plan_subscriptions
   where professional_id = p_professional_id and status in ('active', 'overdue')
   for update;
  if not found then
    raise exception 'Nenhuma assinatura ativa para trocar de plano.';
  end if;

  select case v_sub.ciclo when 'anual' then preco_anual else preco_mensal end
    into v_novo_valor
    from public.subscription_plans
   where id = p_novo_plano_id and ativo and publico;
  if v_novo_valor is null then raise exception 'Plano indisponível para este ciclo.'; end if;
  if v_novo_valor >= v_sub.amount then
    raise exception 'Isto não é downgrade — o plano escolhido não é mais barato que o atual.';
  end if;

  update public.plan_subscriptions
     set proximo_plano_id = p_novo_plano_id
   where id = v_sub.id;
end;
$$;

revoke all on function public.solicitar_downgrade_assinatura(uuid, uuid) from public, anon, authenticated;
grant execute on function public.solicitar_downgrade_assinatura(uuid, uuid) to service_role;

-- `minha_assinatura_atual` aprende a mostrar o downgrade agendado. Muda o
-- formato de retorno (novas colunas) — CREATE OR REPLACE não permite isso
-- para RETURNS TABLE, precisa recriar.
drop function if exists public.minha_assinatura_atual();

create function public.minha_assinatura_atual()
returns table (
  subscription_id uuid,
  plano_slug text,
  plano_nome text,
  ciclo text,
  valor numeric,
  status text,
  auto_renova boolean,
  next_due_date date,
  proximo_plano_slug text,
  proximo_plano_nome text
)
language sql
security definer
stable
set search_path = public
as $$
  select s.id, sp.slug, sp.nome, s.ciclo, s.amount, s.status, s.auto_renova, s.next_due_date,
         spx.slug, spx.nome
    from public.plan_subscriptions s
    join public.subscription_plans sp on sp.id = s.plan_id
    left join public.subscription_plans spx on spx.id = s.proximo_plano_id
   where s.professional_id = (select auth.uid())
     and s.status in ('pending_first_payment', 'active', 'overdue')
   order by s.created_at desc
   limit 1;
$$;

revoke all on function public.minha_assinatura_atual() from public, anon;
grant execute on function public.minha_assinatura_atual() to authenticated;

-- ---------------------------------------------------------------------------
-- PAYMENT_RECEIVED aprende a liquidar upgrade: troca o plano vigente sem
-- mexer no vencimento (a diferença cobrada é só o ajuste do período corrente,
-- não um novo ciclo).
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
  v_subscription_viva boolean;
  v_novo_valor numeric(12,2);
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
       where id = v_charge.id and status not in ('refunded', 'disputed', 'cancelled');

      if v_charge.order_id is not null then
        update public.orders set payment_status = 'pago', payment_ref = v_charge.gateway_payment_id
         where id = v_charge.order_id and payment_status <> 'reembolsado';
      end if;

      if v_charge.subscription_id is not null then
        select (status <> 'cancelled') into v_subscription_viva
          from public.plan_subscriptions where id = v_charge.subscription_id;

        if coalesce(v_subscription_viva, false) then
          if v_charge.plano_alvo_id is not null then
            -- Cobrança de upgrade: troca o plano vigente, mantém o
            -- vencimento como estava — não é um novo ciclo, é ajuste do
            -- período corrente.
            select case (select ciclo from public.plan_subscriptions where id = v_charge.subscription_id)
                     when 'anual' then preco_anual else preco_mensal
                   end
              into v_novo_valor
              from public.subscription_plans where id = v_charge.plano_alvo_id;

            update public.plan_subscriptions
               set plan_id = v_charge.plano_alvo_id,
                   amount = coalesce(v_novo_valor, amount)
             where id = v_charge.subscription_id;
          else
            v_next_due := (v_event.occurred_at at time zone 'utc')::date
              + case (select ciclo from public.plan_subscriptions where id = v_charge.subscription_id)
                  when 'anual' then interval '1 year' else interval '1 month'
                end;
            update public.plan_subscriptions
               set status = 'active', next_due_date = v_next_due
             where id = v_charge.subscription_id;
          end if;

          update public.professionals
             set subscription_status = 'ativa',
                 subscription_plan_id = (select plan_id from public.plan_subscriptions where id = v_charge.subscription_id)
           where id = (select professional_id from public.plan_subscriptions where id = v_charge.subscription_id);
        end if;
      end if;

    when 'PAYMENT_OVERDUE' then
      if v_charge.status in ('pending', 'confirmed') then
        update public.payment_charges set status = 'overdue' where id = v_charge.id;
      end if;
      if v_charge.subscription_id is not null then
        update public.plan_subscriptions set status = 'overdue'
         where id = v_charge.subscription_id and status <> 'cancelled';
        update public.professionals set subscription_status = 'inadimplente'
         where id = (select professional_id from public.plan_subscriptions where id = v_charge.subscription_id)
           and exists (
             select 1 from public.plan_subscriptions
              where id = v_charge.subscription_id and status = 'overdue'
           );
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
