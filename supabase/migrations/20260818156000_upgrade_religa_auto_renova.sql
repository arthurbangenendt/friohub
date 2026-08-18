-- ============================================================================
-- Correção: upgrade não desfazia um cancelamento agendado anterior
-- ============================================================================
--
-- Bug real encontrado testando em produção: Jonathas tinha cancelado a
-- assinatura (auto_renova=false, acesso até next_due_date) e depois fez
-- upgrade para o Master. A cobrança liquidou, o plano trocou — mas
-- auto_renova continuou false, e a tela seguia mostrando "cancelamento
-- agendado" mesmo ele tendo acabado de pagar para continuar assinando.
--
-- Quem paga para trocar de plano claramente não quer que a assinatura pare —
-- upgrade desfaz qualquer cancelamento agendado anterior.

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
            -- vencimento como estava, e desfaz qualquer cancelamento
            -- agendado — quem paga para trocar de plano quer continuar
            -- assinando, não só terminar o período corrente.
            select case (select ciclo from public.plan_subscriptions where id = v_charge.subscription_id)
                     when 'anual' then preco_anual else preco_mensal
                   end
              into v_novo_valor
              from public.subscription_plans where id = v_charge.plano_alvo_id;

            update public.plan_subscriptions
               set plan_id = v_charge.plano_alvo_id,
                   amount = coalesce(v_novo_valor, amount),
                   auto_renova = true,
                   cancelled_at = null,
                   proximo_plano_id = null
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
