-- Fase 5 — resiliência, rollout gradual e proteção contra abuso.
-- Não configura fornecedores externos nem cria uma falsa garantia de backup remoto.

-- ---------------------------------------------------------------------------
-- 1. Praças e feature flags
-- ---------------------------------------------------------------------------
create table public.marketplace_regions (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9-]{2,80}$'),
  city         text not null,
  state        text not null check (state ~ '^[A-Z]{2}$'),
  active       boolean not null default false,
  launch_stage text not null default 'internal'
               check (launch_stage in ('internal', 'pilot', 'public', 'paused')),
  config       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.feature_flags (
  id                 uuid primary key default gen_random_uuid(),
  flag_key           text not null check (flag_key ~ '^[a-z0-9_]{2,100}$'),
  region_id          uuid references public.marketplace_regions (id) on delete cascade,
  description        text not null,
  enabled            boolean not null default false,
  rollout_percentage integer not null default 0 check (rollout_percentage between 0 and 100),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index uq_feature_flags_global on public.feature_flags (flag_key)
  where region_id is null;
create unique index uq_feature_flags_region on public.feature_flags (flag_key, region_id)
  where region_id is not null;

alter table public.marketplace_regions enable row level security;
alter table public.feature_flags enable row level security;

create policy "marketplace_regions_active_read" on public.marketplace_regions
  for select to anon, authenticated
  using (active or (select public.eh_admin()));
create policy "feature_flags_admin_read" on public.feature_flags
  for select to authenticated using ((select public.eh_admin()));

grant select on public.marketplace_regions to anon, authenticated;
grant select on public.feature_flags to authenticated;
revoke insert, update, delete on public.marketplace_regions, public.feature_flags
  from anon, authenticated;

create trigger trg_marketplace_regions_touch before update on public.marketplace_regions
  for each row execute function public.touch_updated_at();
create trigger trg_feature_flags_touch before update on public.feature_flags
  for each row execute function public.touch_updated_at();

insert into public.marketplace_regions (slug, city, state, active, launch_stage)
values ('sao-paulo-sp', 'São Paulo', 'SP', true, 'pilot');

insert into public.feature_flags (flag_key, region_id, description, enabled, rollout_percentage)
select f.flag_key, r.id, f.description, f.enabled, f.rollout
  from public.marketplace_regions r
 cross join (values
   ('pmoc', 'Operação recorrente de PMOC', true, 100),
   ('sponsored_placements', 'Destaques pagos e rotulados', false, 0),
   ('professional_subscriptions', 'Cobrança recorrente de profissionais', false, 0),
   ('asaas_payments', 'Cobranças e webhooks reais via Asaas', false, 0)
 ) as f(flag_key, description, enabled, rollout)
 where r.slug = 'sao-paulo-sp';

create or replace function public.feature_enabled(
  p_flag_key text,
  p_region_slug text default 'sao-paulo-sp',
  p_subject_id text default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with resolved as (
    select ff.enabled, ff.rollout_percentage
      from public.feature_flags ff
      left join public.marketplace_regions mr on mr.id = ff.region_id
     where ff.flag_key = p_flag_key
       and (mr.slug = p_region_slug or ff.region_id is null)
       and (ff.region_id is null or (mr.active and mr.launch_stage <> 'paused'))
     order by ff.region_id nulls last
     limit 1
  )
  select coalesce(
    enabled and (
      rollout_percentage = 100
      or (rollout_percentage > 0 and p_subject_id is not null and
          ((hashtextextended(p_flag_key || ':' || p_subject_id, 0) & 9223372036854775807) % 100) < rollout_percentage)
    ), false
  ) from resolved;
$$;

revoke all on function public.feature_enabled(text, text, text) from public;
grant execute on function public.feature_enabled(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Rate limiting transacional nos fluxos de escrita críticos
-- ---------------------------------------------------------------------------
create table public.rate_limit_buckets (
  scope          text not null,
  subject_id     uuid not null,
  window_seconds integer not null check (window_seconds > 0),
  window_start   timestamptz not null,
  expires_at     timestamptz not null,
  hits           integer not null check (hits > 0),
  primary key (scope, subject_id, window_seconds)
);

alter table public.rate_limit_buckets enable row level security;
revoke all on public.rate_limit_buckets from public, anon, authenticated;

create or replace function public.consume_rate_limit(
  p_scope text,
  p_subject_id uuid,
  p_max_hits integer,
  p_window_seconds integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
begin
  if p_subject_id is null or p_max_hits < 1 or p_window_seconds < 1 then
    raise exception 'Configuração inválida de rate limit.';
  end if;

  insert into public.rate_limit_buckets (
    scope, subject_id, window_seconds, window_start, expires_at, hits
  ) values (
    p_scope, p_subject_id, p_window_seconds, now(), now() + make_interval(secs => p_window_seconds), 1
  )
  on conflict (scope, subject_id, window_seconds) do update
     set hits = case when rate_limit_buckets.expires_at <= now() then 1 else rate_limit_buckets.hits + 1 end,
         window_start = case when rate_limit_buckets.expires_at <= now() then now() else rate_limit_buckets.window_start end,
         expires_at = case when rate_limit_buckets.expires_at <= now() then now() + make_interval(secs => p_window_seconds) else rate_limit_buckets.expires_at end
  returning hits into v_hits;

  if v_hits > p_max_hits then
    raise exception 'Limite de solicitações excedido. Aguarde antes de tentar novamente.'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.consume_rate_limit(text, uuid, integer, integer)
  from public, anon, authenticated;

create or replace function public.enforce_marketplace_rate_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  -- Escritas internas/service role não têm JWT de usuário e usam suas próprias filas.
  if v_uid is null then return new; end if;

  if tg_table_name = 'quote_requests' then
    perform public.consume_rate_limit('quote_request_hour', v_uid, 5, 3600);
    perform public.consume_rate_limit('quote_request_day', v_uid, 20, 86400);
  elsif tg_table_name = 'messages' then
    perform public.consume_rate_limit('message_minute', v_uid, 30, 60);
    perform public.consume_rate_limit('message_day', v_uid, 500, 86400);
  elsif tg_table_name = 'pmoc_plans' then
    perform public.consume_rate_limit('pmoc_request_day', v_uid, 3, 86400);
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_marketplace_rate_limits() from public, anon, authenticated;
create trigger trg_quote_requests_rate_limit before insert on public.quote_requests
  for each row execute function public.enforce_marketplace_rate_limits();
create trigger trg_messages_rate_limit before insert on public.messages
  for each row execute function public.enforce_marketplace_rate_limits();
create trigger trg_pmoc_plans_rate_limit before insert on public.pmoc_plans
  for each row execute function public.enforce_marketplace_rate_limits();

-- ---------------------------------------------------------------------------
-- 3. Health checks persistidos (detecção, não promessa de correção automática)
-- ---------------------------------------------------------------------------
create table public.system_health_runs (
  id          uuid primary key default gen_random_uuid(),
  status      text not null check (status in ('healthy', 'degraded', 'down')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz not null default now()
);

create table public.system_health_checks (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.system_health_runs (id) on delete cascade,
  component      text not null,
  status         text not null check (status in ('healthy', 'degraded', 'down')),
  observed_value numeric,
  threshold      numeric,
  details        jsonb not null default '{}'::jsonb,
  checked_at     timestamptz not null default now(),
  unique (run_id, component)
);

create index idx_system_health_runs_latest on public.system_health_runs (started_at desc);
create index idx_system_health_checks_problem on public.system_health_checks (checked_at desc)
  where status <> 'healthy';

alter table public.system_health_runs enable row level security;
alter table public.system_health_checks enable row level security;
create policy "system_health_runs_admin_read" on public.system_health_runs
  for select to authenticated using ((select public.eh_admin()));
create policy "system_health_checks_admin_read" on public.system_health_checks
  for select to authenticated using ((select public.eh_admin()));
grant select on public.system_health_runs, public.system_health_checks to authenticated;
revoke insert, update, delete on public.system_health_runs, public.system_health_checks
  from anon, authenticated;

create or replace function public.avaliar_saude_sistema()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid := gen_random_uuid();
  v_count bigint;
  v_age_minutes numeric;
  v_overall text := 'healthy';
begin
  if not pg_try_advisory_xact_lock(hashtextextended('friohub:system-health', 0)) then
    select id into v_run_id from public.system_health_runs order by started_at desc limit 1;
    return v_run_id;
  end if;

  insert into public.system_health_runs (id, status) values (v_run_id, 'healthy');
  insert into public.system_health_checks (run_id, component, status, observed_value, threshold)
  values (v_run_id, 'database', 'healthy', 1, 1);

  select count(*) into v_count from public.notification_outbox
   where status in ('pending', 'failed') and available_at < now() - interval '15 minutes';
  insert into public.system_health_checks (run_id, component, status, observed_value, threshold)
  values (v_run_id, 'notification_outbox', case when v_count >= 100 then 'down' when v_count > 0 then 'degraded' else 'healthy' end, v_count, 0);

  select count(*) into v_count from public.payment_gateway_events
   where processing_status in ('pending', 'error') and received_at < now() - interval '15 minutes';
  insert into public.system_health_checks (run_id, component, status, observed_value, threshold)
  values (v_run_id, 'payment_webhooks', case when v_count >= 20 then 'down' when v_count > 0 then 'degraded' else 'healthy' end, v_count, 0);

  select extract(epoch from (now() - max(started_at))) / 60 into v_age_minutes
    from public.financial_reconciliation_runs where status = 'completed';
  insert into public.system_health_checks (run_id, component, status, observed_value, threshold, details)
  values (v_run_id, 'financial_reconciliation',
    case when v_age_minutes is null or v_age_minutes > 180 then 'down' when v_age_minutes > 90 then 'degraded' else 'healthy' end,
    v_age_minutes, 90, jsonb_build_object('unit', 'minutes_since_last_success'));

  select count(*) into v_count from public.operational_cases
   where status = 'open' and priority = 'critical';
  insert into public.system_health_checks (run_id, component, status, observed_value, threshold)
  values (v_run_id, 'marketplace_sla', case when v_count >= 10 then 'down' when v_count > 0 then 'degraded' else 'healthy' end, v_count, 0);

  select count(*) into v_count from public.pmoc_visits
   where status = 'planned' and due_date < current_date;
  insert into public.system_health_checks (run_id, component, status, observed_value, threshold)
  values (v_run_id, 'pmoc_visits', case when v_count >= 20 then 'down' when v_count > 0 then 'degraded' else 'healthy' end, v_count, 0);

  select case when bool_or(status = 'down') then 'down'
                   when bool_or(status = 'degraded') then 'degraded'
                   else 'healthy' end
    into v_overall from public.system_health_checks where run_id = v_run_id;
  update public.system_health_runs set status = v_overall, finished_at = now() where id = v_run_id;

  delete from public.system_health_runs where started_at < now() - interval '90 days';
  delete from public.rate_limit_buckets where expires_at < now() - interval '1 day';
  return v_run_id;
end;
$$;

revoke all on function public.avaliar_saude_sistema() from public, anon, authenticated;

create or replace function public.obter_saude_publica()
returns table (status text, checked_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(r.status, 'down'), r.finished_at
    from (select 1) seed
    left join lateral (
      select status, finished_at from public.system_health_runs order by started_at desc limit 1
    ) r on true;
$$;

revoke all on function public.obter_saude_publica() from public;
grant execute on function public.obter_saude_publica() to anon, authenticated;

select public.avaliar_saude_sistema();
select cron.schedule(
  'friohub-system-health',
  '*/5 * * * *',
  'select public.avaliar_saude_sistema();'
);

comment on function public.obter_saude_publica() is
  'Expõe somente estado agregado e horário; detalhes operacionais permanecem restritos ao admin.';
