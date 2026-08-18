-- ============================================================================
-- Reconciliação manual: religar uma assinatura cancelada que recebeu dinheiro
-- ============================================================================
--
-- Cenário real (20260818150000): fatura de uma assinatura já cancelada
-- localmente chega paga mesmo assim. O dinheiro entra no ledger, mas ninguém
-- é promovido automaticamente — fica esperando decisão humana. Esta RPC é
-- essa decisão: um admin escolhe explicitamente reviver aquela assinatura
-- específica, mesmo que o profissional já tenha outra tentativa pendente ou
-- ativa (a outra é cancelada — só uma pode ocupar o lugar por vez, ver
-- uq_plan_subscriptions_active_professional).
--
-- Não tenta adivinhar automaticamente qual assinatura "deveria" ganhar; exige
-- o id explícito e confere que existe mesmo um recebimento no ledger para
-- ela — sem isso, "reconciliar" seria só inventar uma ativação sem lastro.

create or replace function public.reconciliar_assinatura_manual(p_subscription_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.plan_subscriptions%rowtype;
  v_charge public.payment_charges%rowtype;
  v_journal public.financial_journals%rowtype;
  v_next_due date;
begin
  select * into v_sub from public.plan_subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'Assinatura não encontrada.'; end if;
  if v_sub.status <> 'cancelled' then
    raise exception 'Só é possível reconciliar assinatura cancelada; esta está em %.', v_sub.status;
  end if;

  select * into v_charge from public.payment_charges
   where subscription_id = p_subscription_id
   order by created_at desc limit 1;
  if not found then raise exception 'Nenhuma cobrança encontrada para esta assinatura.'; end if;

  select * into v_journal from public.financial_journals
   where charge_id = v_charge.id and journal_type = 'payment_received'
   limit 1;
  if not found then
    raise exception 'Nenhum lançamento de recebimento no ledger para esta cobrança — nada para reconciliar.';
  end if;

  -- Supersede qualquer outra tentativa em jogo: a decisão manual é definitiva.
  update public.plan_subscriptions
     set status = 'cancelled', cancelled_at = now()
   where professional_id = v_sub.professional_id
     and id <> p_subscription_id
     and status in ('pending_first_payment', 'active', 'overdue');
  update public.payment_charges
     set status = 'cancelled'
   where subscription_id in (
     select id from public.plan_subscriptions
      where professional_id = v_sub.professional_id and id <> p_subscription_id
   )
   and status in ('pending_creation', 'pending');

  v_next_due := (v_journal.occurred_at at time zone 'utc')::date
    + case v_sub.ciclo when 'anual' then interval '1 year' else interval '1 month' end;

  update public.plan_subscriptions
     set status = 'active', next_due_date = v_next_due, cancelled_at = null
   where id = p_subscription_id;

  update public.payment_charges
     set status = 'received'
   where id = v_charge.id;

  update public.professionals
     set subscription_status = 'ativa', subscription_plan_id = v_sub.plan_id
   where id = v_sub.professional_id;
end;
$$;

revoke all on function public.reconciliar_assinatura_manual(uuid) from public, anon, authenticated;
grant execute on function public.reconciliar_assinatura_manual(uuid) to service_role;

comment on function public.reconciliar_assinatura_manual(uuid) is
  'Ação de admin: religa uma assinatura cancelada que recebeu dinheiro mesmo assim, cancelando qualquer outra tentativa em jogo do mesmo profissional. Não é chamada automaticamente por nenhum fluxo.';
