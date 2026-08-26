-- ============================================================================
-- Promover/revogar admin, auditado
-- ============================================================================
--
-- Hoje isso só existe como UPDATE direto no banco — foi literalmente assim
-- que o primeiro admin nasceu (20260811200000_admin_verificacao.sql). Conforme
-- o time cresce, cada promoção feita fora do produto é um ponto cego de
-- segurança sem registro nenhum em `admin_audit_log`.
--
-- Mesmo molde de `definir_verificacao` (20260813160000): SECURITY DEFINER,
-- checa eh_admin(), justificativa obrigatória, grava old/new no log.
--
-- Só alterna cliente <-> admin. Nunca mexe em profissional/distribuidora —
-- esses papéis têm ciclo de vida próprio (verificação) e trocar o role por
-- aqui destruiria o vínculo com `professionals`/`distributors` sem apagar a
-- linha correspondente, deixando o sistema inconsistente.
--
-- `protege_role_profile` (20260812200000_trava_role.sql) segue intacta: ela só
-- deixa passar update de `role` quando `current_user not in ('authenticated',
-- 'anon')`. Dentro de uma função SECURITY DEFINER, `current_user` passa a ser
-- o dono da função (não mais `authenticated`), então o UPDATE abaixo atravessa
-- a trava sem precisar alterá-la — mesmo mecanismo, comportamento confirmado
-- pelo teste pgTAP desta migration antes de considerar pronto.

create or replace function public.alterar_papel_usuario(
  p_user_id uuid,
  p_new_role text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old_role text;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_uid is null or not public.eh_admin() then
    raise exception 'Acesso restrito a administradores.';
  end if;

  if p_new_role not in ('admin', 'cliente') then
    raise exception 'Esta função só alterna entre cliente e admin.';
  end if;

  if p_user_id = v_uid then
    raise exception 'Você não pode alterar o próprio papel por aqui.';
  end if;

  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'Informe uma justificativa entre 5 e 500 caracteres.';
  end if;

  select role into v_old_role from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'Usuário não encontrado.';
  end if;

  if v_old_role not in ('admin', 'cliente') then
    raise exception 'Esta função não altera profissional nem distribuidora — eles têm ciclo de vida próprio.';
  end if;

  if v_old_role = p_new_role then
    raise exception 'Usuário já está nesse papel.';
  end if;

  update public.profiles set role = p_new_role where id = p_user_id;

  insert into public.admin_audit_log (
    actor_id, action, entity_type, entity_id, old_values, new_values, reason
  ) values (
    v_uid, 'role_changed', 'profile', p_user_id,
    jsonb_build_object('role', v_old_role),
    jsonb_build_object('role', p_new_role),
    v_reason
  );
end;
$$;

revoke all on function public.alterar_papel_usuario(uuid, text, text)
  from public, anon;
grant execute on function public.alterar_papel_usuario(uuid, text, text)
  to authenticated;

comment on function public.alterar_papel_usuario(uuid, text, text) is
  'Alterna papel entre cliente e admin, com autorização, justificativa obrigatória e auditoria. Nunca mexe em profissional/distribuidora.';
