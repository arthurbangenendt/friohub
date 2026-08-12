-- ============================================================================
-- `profiles.telefone` deixou de existir (ver 20260812120000_profile_private).
-- O trigger de cadastro precisa acompanhar, senão TODO signup passa a falhar.
--
-- Passa a gravar telefone e CPF/CNPJ em `profile_private`. A função é
-- security definer, então escreve na tabela restrita sem esbarrar na RLS.
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
begin
  -- Só aceita papéis válidos vindos do cadastro público
  if v_role not in ('cliente', 'profissional') then
    v_role := 'cliente';
  end if;

  insert into public.profiles (id, role, nome)
  values (
    new.id,
    v_role,
    coalesce(nullif(new.raw_user_meta_data->>'nome', ''), split_part(new.email, '@', 1))
  );

  -- Só materializa a linha privada se houver algum dado sensível de fato.
  if v_telefone is not null or v_cpf_cnpj is not null then
    insert into public.profile_private (id, telefone, cpf_cnpj)
    values (new.id, v_telefone, v_cpf_cnpj);
  end if;

  return new;
end;
$$;
