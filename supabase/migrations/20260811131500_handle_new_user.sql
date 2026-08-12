-- ============================================================================
-- Cria automaticamente um profile quando um usuário se cadastra (auth.users).
-- O nome e o papel (cliente/profissional) vêm do metadata do signup.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(new.raw_user_meta_data->>'role', 'cliente');
begin
  -- Só aceita papéis válidos vindos do cadastro público
  if v_role not in ('cliente', 'profissional') then
    v_role := 'cliente';
  end if;

  insert into public.profiles (id, role, nome, telefone)
  values (
    new.id,
    v_role,
    coalesce(nullif(new.raw_user_meta_data->>'nome', ''), split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'telefone'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
