-- ============================================================================
-- obter_checkout_cobranca passa a devolver também o valor
-- ============================================================================
--
-- asaas-trocar-plano precisa saber o valor da cobrança de upgrade já
-- preparada (o proporcional calculado por preparar_upgrade_assinatura) antes
-- de criar o pagamento no Asaas — sem isso teria que recalcular a diferença
-- do lado da Edge Function, duplicando a regra de negócio que já vive na RPC.

drop function if exists public.obter_checkout_cobranca(uuid);

create function public.obter_checkout_cobranca(p_charge_id uuid)
returns table (checkout_url text, status text, amount numeric)
language sql
security definer
stable
set search_path = public
as $$
  select checkout_url, status, amount from public.payment_charges where id = p_charge_id;
$$;

revoke all on function public.obter_checkout_cobranca(uuid) from public, anon, authenticated;
grant execute on function public.obter_checkout_cobranca(uuid) to service_role;
