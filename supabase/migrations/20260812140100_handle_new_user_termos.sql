-- ============================================================================
-- Registra o aceite dos termos no momento do cadastro.
--
-- Gravar aqui, dentro do trigger, garante que o aceite nasce junto com a conta.
-- Fazer isso num UPDATE depois do signup seria frágil: quando a confirmação de
-- email está ligada não existe sessão logo após o cadastro, e o aceite se perderia.
--
-- A VERSÃO é gravada junto — é o que permite provar a qual texto a pessoa
-- consentiu depois que os termos mudarem.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role     text := coalesce(new.raw_user_meta_data->>'role', 'cliente');
  v_telefone text := nullif(new.raw_user_meta_data->>'telefone', '');
  v_cpf_cnpj text := nullif(new.raw_user_meta_data->>'cpf_cnpj', '');
  v_termos   text := nullif(new.raw_user_meta_data->>'termos_versao', '');
begin
  if v_role not in ('cliente', 'profissional') then
    v_role := 'cliente';
  end if;

  insert into public.profiles (id, role, nome)
  values (
    new.id,
    v_role,
    coalesce(nullif(new.raw_user_meta_data->>'nome', ''), split_part(new.email, '@', 1))
  );

  if v_telefone is not null or v_cpf_cnpj is not null or v_termos is not null then
    insert into public.profile_private (id, telefone, cpf_cnpj, termos_versao, termos_aceitos_em)
    values (
      new.id, v_telefone, v_cpf_cnpj, v_termos,
      case when v_termos is not null then now() else null end
    );
  end if;

  return new;
end;
$$;
