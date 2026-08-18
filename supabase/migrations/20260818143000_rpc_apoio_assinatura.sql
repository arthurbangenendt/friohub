-- ============================================================================
-- RPCs de apoio para a Edge Function `asaas-assinar`
-- ============================================================================
--
-- `service_role` não tem GRANT direto de SELECT/INSERT/UPDATE em nenhuma
-- tabela deste schema (privilégio default de tabela criada por `postgres` só
-- dá TRUNCATE/REFERENCES/TRIGGER — conferido em produção: nenhuma migration
-- jamais concedeu select/insert/update a service_role). Toda leitura/escrita
-- de backend confiável passa por RPC security definer, sem exceção.

-- Erra explicitamente para "não é profissional" — null sozinho já significa
-- "é profissional, mas ainda sem documento", e o chamador precisa distinguir
-- os dois casos.
create or replace function public.obter_cpf_cnpj_professional(p_user_id uuid)
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_cpf_cnpj text;
begin
  select cpf_cnpj into v_cpf_cnpj from public.professionals where id = p_user_id;
  if not found then
    raise exception 'Perfil não é de profissional.';
  end if;
  return v_cpf_cnpj;
end;
$$;

revoke all on function public.obter_cpf_cnpj_professional(uuid) from public, anon, authenticated;
grant execute on function public.obter_cpf_cnpj_professional(uuid) to service_role;

-- Só grava se ainda não houver documento: é coleta única, não edição de
-- cadastro (edição de CPF/CNPJ depois de vinculado ao gateway é fora de
-- escopo — mudaria a identidade do pagador).
create or replace function public.definir_cpf_cnpj_professional(
  p_user_id uuid,
  p_cpf_cnpj text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.professionals
     set cpf_cnpj = p_cpf_cnpj
   where id = p_user_id and cpf_cnpj is null;
end;
$$;

revoke all on function public.definir_cpf_cnpj_professional(uuid, text)
  from public, anon, authenticated;
grant execute on function public.definir_cpf_cnpj_professional(uuid, text)
  to service_role;

create or replace function public.obter_plano_publico(p_slug text)
returns table (id uuid, nome text, preco_mensal numeric, preco_anual numeric)
language sql
security definer
stable
set search_path = public
as $$
  select id, nome, preco_mensal, preco_anual
    from public.subscription_plans
   where slug = p_slug and ativo and publico;
$$;

revoke all on function public.obter_plano_publico(text) from public, anon, authenticated;
grant execute on function public.obter_plano_publico(text) to service_role;

create or replace function public.obter_nome_perfil(p_user_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select nome from public.profiles where id = p_user_id;
$$;

revoke all on function public.obter_nome_perfil(uuid) from public, anon, authenticated;
grant execute on function public.obter_nome_perfil(uuid) to service_role;

create or replace function public.obter_checkout_cobranca(p_charge_id uuid)
returns table (checkout_url text, status text)
language sql
security definer
stable
set search_path = public
as $$
  select checkout_url, status from public.payment_charges where id = p_charge_id;
$$;

revoke all on function public.obter_checkout_cobranca(uuid) from public, anon, authenticated;
grant execute on function public.obter_checkout_cobranca(uuid) to service_role;
