-- ============================================================================
-- ESCALAÇÃO DE PRIVILÉGIO: qualquer usuário podia virar admin.
--
-- `profiles_self_all` é `for all` sobre a linha inteira, e `role` mora nessa
-- linha. RLS é por LINHA, não por COLUNA — então um cliente logado conseguia
--
--   PATCH /rest/v1/profiles?id=eq.<seu id>   {"role":"admin"}
--
-- e virar administrador pela API pública. Verificado com uma conta real: a
-- escrita na coluna `role` retornou sucesso.
--
-- Isso também anulava a trava de 20260812170000: aquela função libera tudo para
-- admin (que é o desenho correto), mas se a própria pessoa pode se declarar
-- admin, a exceção vira a porta de entrada — autopromove, depois autoverifica
-- e mexe na assinatura.
--
-- Correção no mesmo modelo das anteriores: preservar em silêncio quando quem
-- escreve é o app (`authenticated`/`anon`). O trigger de cadastro
-- (handle_new_user) é SECURITY DEFINER e roda como dono, então continua
-- definindo o papel inicial normalmente.
--
-- Promover alguém a admin passa a exigir acesso direto ao banco ou uma ação
-- feita por quem já é admin. Não há mais caminho pela API pública.
-- ============================================================================
create or replace function public.protege_role_profile()
returns trigger
language plpgsql
as $$
declare
  v_admin boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;  -- handle_new_user, migrations, service_role
  end if;

  if tg_op = 'INSERT' then
    -- Nenhum caminho do app cria profile direto; se criar, nasce como cliente.
    new.role := 'cliente';
    return new;
  end if;

  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ) into v_admin;

  if not v_admin then
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_protege_role on public.profiles;
create trigger trg_profiles_protege_role
  before insert or update on public.profiles
  for each row execute function public.protege_role_profile();

comment on function public.protege_role_profile is
  'Impede autopromoção a admin. RLS é por linha; esta trava é por coluna.';
