-- ============================================================================
-- RPCs para `payment_customers` — a tabela nunca teve GRANT para service_role
-- ============================================================================
--
-- 20260813172401 revogou tudo de anon/authenticated e nunca concedeu nada a
-- service_role (só os privilégios implícitos de TRUNCATE/REFERENCES/TRIGGER
-- que o Postgres dá por padrão). Consistente com o resto do ADR 001: toda
-- escrita financeira passa por RPC security definer, nunca pela Data API.

create or replace function public.obter_payment_customer(
  p_user_id uuid,
  p_gateway text
)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select gateway_customer_id from public.payment_customers
   where user_id = p_user_id and gateway = p_gateway;
$$;

revoke all on function public.obter_payment_customer(uuid, text) from public, anon, authenticated;
grant execute on function public.obter_payment_customer(uuid, text) to service_role;

create or replace function public.registrar_payment_customer(
  p_user_id uuid,
  p_gateway text,
  p_gateway_customer_id text,
  p_external_reference text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_gateway <> 'asaas' then raise exception 'Gateway não suportado.'; end if;
  if nullif(btrim(p_gateway_customer_id), '') is null then
    raise exception 'Customer do gateway obrigatório.';
  end if;

  insert into public.payment_customers (user_id, gateway, gateway_customer_id, external_reference)
  values (p_user_id, p_gateway, btrim(p_gateway_customer_id), btrim(p_external_reference))
  on conflict (user_id) do update
    set gateway_customer_id = excluded.gateway_customer_id,
        external_reference = excluded.external_reference;
end;
$$;

revoke all on function public.registrar_payment_customer(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.registrar_payment_customer(uuid, text, text, text)
  to service_role;
