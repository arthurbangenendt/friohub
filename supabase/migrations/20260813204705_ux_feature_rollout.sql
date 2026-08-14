-- Rollout reversível das experiências UX 2–5. As flags começam em 100% para
-- preservar o comportamento atual da praça piloto.
insert into public.feature_flags (flag_key, region_id, description, enabled, rollout_percentage)
select candidate.flag_key, region.id, candidate.description, true, 100
from public.marketplace_regions region
cross join (values
  ('ux_pipeline', 'Pipeline, follow-up e comparação de propostas'),
  ('ux_execution', 'Modo execução e relatório técnico'),
  ('ux_portfolio', 'Equipamentos, carteira de clientes e recorrência'),
  ('ux_growth', 'Desempenho, metas e assistente de perfil')
) as candidate(flag_key, description)
where region.slug = 'sao-paulo-sp'
  and not exists (
    select 1 from public.feature_flags existing
    where existing.flag_key = candidate.flag_key and existing.region_id = region.id
  );

create or replace function public.configurar_feature_flag(
  p_flag_key text,
  p_region_slug text,
  p_enabled boolean,
  p_rollout_percentage integer,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_flag public.feature_flags%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null or not (select public.eh_admin()) then
    raise exception 'Acesso restrito a administradores.';
  end if;
  if p_rollout_percentage not between 0 and 100 then
    raise exception 'Percentual de rollout inválido.';
  end if;
  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'Informe uma justificativa entre 5 e 500 caracteres.';
  end if;

  select flag.* into v_flag
  from public.feature_flags flag
  join public.marketplace_regions region on region.id = flag.region_id
  where flag.flag_key = p_flag_key and region.slug = p_region_slug
  for update of flag;
  if not found then raise exception 'Feature flag regional não encontrada.'; end if;

  update public.feature_flags
     set enabled = p_enabled, rollout_percentage = p_rollout_percentage
   where id = v_flag.id;

  insert into public.admin_audit_log (
    actor_id, action, entity_type, entity_id, old_values, new_values, reason
  ) values (
    v_uid, 'feature_flag_changed', 'feature_flag', v_flag.id,
    jsonb_build_object('enabled', v_flag.enabled, 'rollout_percentage', v_flag.rollout_percentage),
    jsonb_build_object('enabled', p_enabled, 'rollout_percentage', p_rollout_percentage),
    v_reason
  );
end;
$$;

revoke all on function public.configurar_feature_flag(text, text, boolean, integer, text)
  from public, anon;
grant execute on function public.configurar_feature_flag(text, text, boolean, integer, text)
  to authenticated;

comment on function public.configurar_feature_flag(text, text, boolean, integer, text) is
  'Altera rollout regional com autorização administrativa, lock e auditoria append-only.';
