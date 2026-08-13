-- ============================================================================
-- CONFIANÇA DE PARCEIROS, CNPJ PRIVADO E AUDITORIA ADMINISTRATIVA
-- ============================================================================

set lock_timeout = '5s';
set statement_timeout = '30s';

-- Alterações materiais invalidam a verificação anterior. O selo representa o
-- conteúdo atual, não apenas uma aprovação histórica.
create or replace function public.protege_confianca_professional()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.eh_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.verification_status  := 'em_analise';
    new.verified_at          := null;
    new.subscription_status  := 'gratis';
    new.subscription_plan_id := null;
  else
    new.subscription_status  := old.subscription_status;
    new.subscription_plan_id := old.subscription_plan_id;

    if old.verification_status = 'verificado' and (
      new.tipo is distinct from old.tipo
      or new.razao_social is distinct from old.razao_social
      or new.bio is distinct from old.bio
      or new.cidade is distinct from old.cidade
      or new.estado is distinct from old.estado
      or new.anos_experiencia is distinct from old.anos_experiencia
    ) then
      new.verification_status := 'em_analise';
      new.verified_at := null;
    else
      new.verification_status := old.verification_status;
      new.verified_at := old.verified_at;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.protege_confianca_distributor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.eh_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.verification_status := 'em_analise';
    new.verified_at := null;
    new.ativo := false;
  elsif old.verification_status = 'verificado' and (
    new.razao_social is distinct from old.razao_social
    or new.cnpj is distinct from old.cnpj
    or new.cidade is distinct from old.cidade
    or new.estado is distinct from old.estado
    or new.prazo_entrega_dias is distinct from old.prazo_entrega_dias
  ) then
    new.verification_status := 'em_analise';
    new.verified_at := null;
    new.ativo := false;
  else
    new.verification_status := old.verification_status;
    new.verified_at := old.verified_at;
    new.ativo := old.ativo;
  end if;
  return new;
end;
$$;

-- Skills, tags e área também fazem parte do que a FrioHub verificou.
create or replace function public.solicita_revalidacao_professional_relacionado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := case when tg_op = 'DELETE' then old.professional_id else new.professional_id end;
begin
  update public.professionals
     set verification_status = 'em_analise', verified_at = null
   where id = v_id and verification_status = 'verificado';
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.solicita_revalidacao_professional_relacionado()
  from public, anon, authenticated;

drop trigger if exists trg_skills_revalidacao on public.professional_skills;
create trigger trg_skills_revalidacao
  after insert or update or delete on public.professional_skills
  for each row execute function public.solicita_revalidacao_professional_relacionado();

drop trigger if exists trg_tags_revalidacao on public.professional_tags;
create trigger trg_tags_revalidacao
  after insert or update or delete on public.professional_tags
  for each row execute function public.solicita_revalidacao_professional_relacionado();

drop trigger if exists trg_areas_revalidacao on public.service_areas;
create trigger trg_areas_revalidacao
  after insert or update or delete on public.service_areas
  for each row execute function public.solicita_revalidacao_professional_relacionado();

create or replace function public.solicita_revalidacao_distributor_area()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := case when tg_op = 'DELETE' then old.distributor_id else new.distributor_id end;
begin
  update public.distributors
     set verification_status = 'em_analise', verified_at = null, ativo = false
   where id = v_id and verification_status = 'verificado';
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.solicita_revalidacao_distributor_area()
  from public, anon, authenticated;

drop trigger if exists trg_dist_areas_revalidacao on public.distributor_areas;
create trigger trg_dist_areas_revalidacao
  after insert or update or delete on public.distributor_areas
  for each row execute function public.solicita_revalidacao_distributor_area();

-- CNPJ deixa de ser uma coluna legível por todos. RLS filtra linhas, não
-- colunas; por isso o acesso próprio/admin é feito por uma função estreita.
revoke select on public.distributors from anon, authenticated;
grant select (
  id, razao_social, cidade, estado, prazo_entrega_dias, verification_status,
  verified_at, ativo, created_at, updated_at
) on public.distributors to anon, authenticated;

create or replace function public.obter_cnpj_distribuidora(p_distributor_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cnpj text;
begin
  if v_uid is null or (v_uid is distinct from p_distributor_id and not public.eh_admin()) then
    raise exception 'Acesso negado.';
  end if;
  select d.cnpj into v_cnpj from public.distributors d where d.id = p_distributor_id;
  return v_cnpj;
end;
$$;

revoke all on function public.obter_cnpj_distribuidora(uuid) from public, anon;
grant execute on function public.obter_cnpj_distribuidora(uuid) to authenticated;

-- Log append-only: nenhuma policy permite INSERT/UPDATE/DELETE pela Data API.
create table public.admin_audit_log (
  id             uuid primary key default gen_random_uuid(),
  actor_id       uuid references public.profiles (id) on delete set null,
  action         text not null,
  entity_type    text not null,
  entity_id      uuid not null,
  old_values     jsonb not null default '{}'::jsonb,
  new_values     jsonb not null default '{}'::jsonb,
  reason         text not null,
  created_at     timestamptz not null default now()
);

create index idx_admin_audit_entity_created
  on public.admin_audit_log (entity_type, entity_id, created_at desc);

alter table public.admin_audit_log enable row level security;
create policy "admin_audit_read" on public.admin_audit_log
  for select to authenticated using ((select public.eh_admin()));

grant select on public.admin_audit_log to authenticated;
revoke insert, update, delete on public.admin_audit_log from anon, authenticated;

create or replace function public.definir_verificacao(
  p_entity_type text,
  p_entity_id uuid,
  p_status text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old_status text;
  v_old_active boolean;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_uid is null or not public.eh_admin() then
    raise exception 'Acesso restrito a administradores.';
  end if;
  if p_entity_type not in ('professional', 'distributor') then
    raise exception 'Tipo de entidade inválido.';
  end if;
  if p_status not in ('verificado', 'rejeitado') then
    raise exception 'Status de verificação inválido.';
  end if;
  if v_reason is null or char_length(v_reason) < 5 then
    raise exception 'Registre uma justificativa com pelo menos cinco caracteres.';
  end if;

  if p_entity_type = 'professional' then
    select verification_status into v_old_status
      from public.professionals where id = p_entity_id for update;
    if not found then raise exception 'Profissional não encontrado.'; end if;

    update public.professionals
       set verification_status = p_status,
           verified_at = case when p_status = 'verificado' then now() else null end
     where id = p_entity_id;
  else
    select verification_status, ativo into v_old_status, v_old_active
      from public.distributors where id = p_entity_id for update;
    if not found then raise exception 'Distribuidora não encontrada.'; end if;

    update public.distributors
       set verification_status = p_status,
           verified_at = case when p_status = 'verificado' then now() else null end,
           ativo = (p_status = 'verificado')
     where id = p_entity_id;
  end if;

  insert into public.admin_audit_log (
    actor_id, action, entity_type, entity_id, old_values, new_values, reason
  ) values (
    v_uid,
    'verification_changed',
    p_entity_type,
    p_entity_id,
    jsonb_strip_nulls(jsonb_build_object('status', v_old_status, 'ativo', v_old_active)),
    jsonb_build_object('status', p_status, 'ativo', case when p_entity_type = 'distributor' then p_status = 'verificado' else null end),
    v_reason
  );
end;
$$;

revoke all on function public.definir_verificacao(text, uuid, text, text)
  from public, anon;
grant execute on function public.definir_verificacao(text, uuid, text, text)
  to authenticated;
