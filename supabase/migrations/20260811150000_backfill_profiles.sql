-- Backfill: cria profiles para usuários que se cadastraram antes do trigger existir
-- (ou quando o cadastro criou o auth.user sem disparar o handle_new_user).
insert into public.profiles (id, role, nome, telefone)
select
  u.id,
  case
    when coalesce(u.raw_user_meta_data->>'role', 'cliente') in ('cliente', 'profissional')
      then u.raw_user_meta_data->>'role'
    else 'cliente'
  end,
  coalesce(nullif(u.raw_user_meta_data->>'nome', ''), split_part(u.email, '@', 1)),
  u.raw_user_meta_data->>'telefone'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;
