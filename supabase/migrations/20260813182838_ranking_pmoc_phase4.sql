-- ============================================================================
-- FASE 4 — RANKING QUALITY_V1 + PMOC RECORRENTE
-- ============================================================================

set lock_timeout = '5s';
set statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 1. Ranking orgânico quality_v1
-- ---------------------------------------------------------------------------
create or replace function public.buscar_profissionais_marketplace(
  p_cep text,
  p_specialty text default null,
  p_query text default null,
  p_sort text default 'relevancia',
  p_require_verified boolean default false,
  p_limit integer default 12,
  p_offset integer default 0
)
returns table (
  professional_id uuid,
  tipo text,
  nome text,
  bio text,
  avatar_url text,
  foto_url text,
  skills jsonb,
  destaque_em text[],
  rating_score numeric,
  jobs_completed integer,
  response_rate numeric,
  active_jobs integer,
  coverage_prefix_length integer,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with candidatos as (
    select
      pr.id,
      pr.tipo,
      pr.verification_status,
      pf.nome,
      pr.bio,
      pf.avatar_url,
      (
        select pi.url
          from public.portfolio_items pi
         where pi.professional_id = pr.id and pi.media_type = 'foto'
         order by pi.position, pi.created_at
         limit 1
      ) as foto_url,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'specialty', ps.specialty,
            'ratingAvg', ps.rating_avg,
            'ratingCount', ps.rating_count,
            'jobsCompleted', ps.jobs_completed,
            'yearsExperience', ps.years_experience
          ) order by ps.specialty
        )
          from public.professional_skills ps
         where ps.professional_id = pr.id
      ), '[]'::jsonb) as skills,
      coalesce((
        select array_agg(fp.specialty order by fp.specialty)
          from public.featured_placements fp
         where fp.professional_id = pr.id
           and fp.ativo
           and fp.starts_at <= now()
           and fp.ends_at > now()
           and public.is_featured_eligible(fp.professional_id, fp.specialty)
      ), '{}'::text[]) as destaque_em,
      coalesce((
        select max(ps.rating_avg)
          from public.professional_skills ps
         where ps.professional_id = pr.id
           and (p_specialty is null or ps.specialty = p_specialty)
      ), 0)::numeric as rating_score,
      coalesce((
        select max(ps.rating_count)
          from public.professional_skills ps
         where ps.professional_id = pr.id
           and (p_specialty is null or ps.specialty = p_specialty)
      ), 0)::integer as rating_count_signal,
      coalesce((
        select max(ps.jobs_completed)
          from public.professional_skills ps
         where ps.professional_id = pr.id
           and (p_specialty is null or ps.specialty = p_specialty)
      ), 0)::integer as jobs_completed,
      coalesce((
        select round(
          count(distinct qu.quote_request_id)::numeric
          / nullif(count(distinct t.quote_request_id), 0), 4
        )
          from public.quote_request_targets t
          left join public.quotes qu
            on qu.quote_request_id = t.quote_request_id
           and qu.professional_id = t.professional_id
         where t.professional_id = pr.id
      ), 0)::numeric as response_rate,
      (
        select count(distinct t.quote_request_id)::integer
          from public.quote_request_targets t
         where t.professional_id = pr.id
      ) as target_count_signal,
      (
        select count(*)::integer
          from public.jobs j
         where j.profissional_id = pr.id
           and j.status in ('aguardando_profissional', 'aceito', 'em_execucao')
      ) as active_jobs,
      (
        select max(length(sa.cep_prefix))::integer
          from public.service_areas sa
         where sa.professional_id = pr.id
           and sa.cep_prefix ~ '^[0-9]{2,5}$'
           and regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g')
                 like sa.cep_prefix || '%'
      ) as coverage_prefix_length
    from public.professionals pr
    join public.profiles pf on pf.id = pr.id
    where (select auth.uid()) is not null
      and regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g') ~ '^[0-9]{8}$'
      and public.profissional_atende_cep(pr.id, p_cep)
      and (not p_require_verified or pr.verification_status = 'verificado')
      and (p_specialty is null or exists (
        select 1 from public.professional_skills ps
         where ps.professional_id = pr.id and ps.specialty = p_specialty
      ))
      and (
        nullif(btrim(coalesce(p_query, '')), '') is null
        or pf.nome ilike '%' || btrim(p_query) || '%'
      )
  ), pontuados as (
    select c.*,
      (
        (
          0.60 * (
            0.80 * (
              ((c.rating_score * c.rating_count_signal) + (4.0 * 5))
              / (c.rating_count_signal + 5) / 5.0
            )
            + 0.20 * least(1.0, ln(1 + c.jobs_completed) / ln(51))
          )
          + 0.25 * (
            ((c.response_rate * c.target_count_signal) + 2.0)
            / (c.target_count_signal + 4.0)
          )
          + 0.15 * (1.0 / (1 + c.active_jobs))
        ) * case when c.verification_status = 'verificado' then 1.0 else 0.85 end
      )::numeric as organic_score
    from candidatos c
  )
  select
    c.id,
    c.tipo,
    c.nome,
    c.bio,
    c.avatar_url,
    c.foto_url,
    c.skills,
    c.destaque_em,
    c.rating_score,
    c.jobs_completed,
    c.response_rate,
    c.active_jobs,
    c.coverage_prefix_length,
    count(*) over () as total_count
  from pontuados c
  order by
    case when p_sort = 'servicos' then c.jobs_completed end desc,
    case when p_sort = 'resposta' then c.response_rate end desc,
    case when p_sort = 'disponibilidade' then c.active_jobs end asc,
    case when p_sort = 'nota' then c.rating_score end desc,
    case when p_sort = 'relevancia' then c.organic_score end desc,
    c.jobs_completed desc,
    c.id
  limit least(24, greatest(1, coalesce(p_limit, 12)))
  offset least(10000, greatest(0, coalesce(p_offset, 0)));
$$;

revoke all on function public.buscar_profissionais_marketplace(text, text, text, text, boolean, integer, integer)
  from public, anon;
grant execute on function public.buscar_profissionais_marketplace(text, text, text, text, boolean, integer, integer)
  to authenticated;

comment on function public.buscar_profissionais_marketplace(text, text, text, text, boolean, integer, integer) is
  'Ranking orgânico quality_v1: 60% qualidade bayesiana/histórico, 25% resposta suavizada e 15% carga ativa; destaque nunca altera a ordem.';

-- ---------------------------------------------------------------------------
-- 2. Domínio PMOC
-- ---------------------------------------------------------------------------
create table public.pmoc_plans (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.profiles (id) on delete restrict,
  professional_id     uuid references public.professionals (id) on delete restrict,
  company_name        text not null check (char_length(company_name) between 2 and 160),
  site_name           text not null check (char_length(site_name) between 2 and 160),
  cep                 text not null check (cep ~ '^[0-9]{8}$'),
  cidade              text not null,
  equipment_count     integer not null check (equipment_count between 1 and 10000),
  interval_months     integer not null check (interval_months in (1, 2, 3, 6, 12)),
  notes               text check (notes is null or char_length(notes) <= 4000),
  price_per_visit     numeric(12,2) check (price_per_visit is null or price_per_visit > 0),
  next_due_date       date,
  status              text not null default 'requested'
                      check (status in ('requested', 'offered', 'active', 'paused', 'cancelled')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_pmoc_plans_client on public.pmoc_plans (client_id, created_at desc);
create index idx_pmoc_plans_professional on public.pmoc_plans (professional_id, created_at desc)
  where professional_id is not null;
create index idx_pmoc_plans_due on public.pmoc_plans (next_due_date)
  where status = 'active';

create table public.pmoc_visits (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references public.pmoc_plans (id) on delete restrict,
  due_date         date not null,
  scheduled_at     timestamptz,
  status           text not null default 'planned'
                   check (status in ('planned', 'completed', 'cancelled', 'missed')),
  completion_notes text check (completion_notes is null or char_length(completion_notes) <= 4000),
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (plan_id, due_date)
);

create index idx_pmoc_visits_pending on public.pmoc_visits (due_date, created_at)
  where status = 'planned';

create table public.pmoc_plan_events (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references public.pmoc_plans (id) on delete restrict,
  actor_id         uuid references public.profiles (id) on delete set null,
  event_type       text not null check (event_type in (
                     'requested', 'assigned', 'accepted', 'declined',
                     'visit_created', 'visit_completed', 'visit_cancelled',
                     'paused', 'cancelled'
                   )),
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index idx_pmoc_events_plan on public.pmoc_plan_events (plan_id, created_at desc);

alter table public.pmoc_plans enable row level security;
alter table public.pmoc_visits enable row level security;
alter table public.pmoc_plan_events enable row level security;

create policy "pmoc_plans_participant_read" on public.pmoc_plans
  for select to authenticated
  using (
    client_id = (select auth.uid())
    or professional_id = (select auth.uid())
    or (select public.eh_admin())
  );

create policy "pmoc_visits_participant_read" on public.pmoc_visits
  for select to authenticated
  using (exists (
    select 1 from public.pmoc_plans p
     where p.id = plan_id
       and (
         p.client_id = (select auth.uid())
         or p.professional_id = (select auth.uid())
         or (select public.eh_admin())
       )
  ));

create policy "pmoc_events_participant_read" on public.pmoc_plan_events
  for select to authenticated
  using (exists (
    select 1 from public.pmoc_plans p
     where p.id = plan_id
       and (
         p.client_id = (select auth.uid())
         or p.professional_id = (select auth.uid())
         or (select public.eh_admin())
       )
  ));

grant select on public.pmoc_plans, public.pmoc_visits, public.pmoc_plan_events to authenticated;
revoke all on public.pmoc_plans, public.pmoc_visits, public.pmoc_plan_events from anon;
revoke insert, update, delete on public.pmoc_plans, public.pmoc_visits, public.pmoc_plan_events
  from authenticated;

create trigger trg_pmoc_plans_touch before update on public.pmoc_plans
  for each row execute function public.touch_updated_at();
create trigger trg_pmoc_visits_touch before update on public.pmoc_visits
  for each row execute function public.touch_updated_at();

create or replace function public.bloqueia_evento_pmoc()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Histórico PMOC é imutável.';
end;
$$;

revoke all on function public.bloqueia_evento_pmoc() from public, anon, authenticated;
create trigger trg_pmoc_events_immutable
  before update or delete on public.pmoc_plan_events
  for each row execute function public.bloqueia_evento_pmoc();

-- Amplia a outbox existente sem criar um segundo sistema de entrega.
alter table public.notification_outbox
  drop constraint notification_outbox_event_type_check;
alter table public.notification_outbox
  add constraint notification_outbox_event_type_check check (event_type in (
    'quote_request_received', 'quote_received', 'quote_accepted',
    'quote_cancelled', 'quote_declined', 'new_message', 'job_updated',
    'appointment_proposed', 'appointment_confirmed', 'appointment_cancelled',
    'appointment_reminder', 'pmoc_offered', 'pmoc_activated', 'pmoc_visit_due'
  ));

alter table public.notification_outbox
  drop constraint notification_outbox_aggregate_type_check;
alter table public.notification_outbox
  add constraint notification_outbox_aggregate_type_check check (aggregate_type in (
    'quote_request', 'job', 'conversation', 'appointment', 'pmoc_plan', 'pmoc_visit'
  ));

create or replace function public.solicitar_pmoc(
  p_company_name text,
  p_site_name text,
  p_cep text,
  p_cidade text,
  p_equipment_count integer,
  p_interval_months integer,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_cep text := regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g');
begin
  if v_uid is null or not exists (
    select 1 from public.profiles where id = v_uid and role in ('cliente', 'admin')
  ) then raise exception 'Apenas clientes autenticados podem solicitar PMOC.'; end if;
  if char_length(btrim(coalesce(p_company_name, ''))) not between 2 and 160 then
    raise exception 'Informe o nome da empresa.';
  end if;
  if char_length(btrim(coalesce(p_site_name, ''))) not between 2 and 160 then
    raise exception 'Informe a unidade atendida.';
  end if;
  if v_cep !~ '^[0-9]{8}$' then raise exception 'Informe um CEP válido.'; end if;
  if coalesce(p_equipment_count, 0) not between 1 and 10000 then
    raise exception 'Quantidade de equipamentos inválida.';
  end if;
  if coalesce(p_interval_months, 0) not in (1, 2, 3, 6, 12) then
    raise exception 'Periodicidade PMOC inválida.';
  end if;
  if char_length(coalesce(p_notes, '')) > 4000 then raise exception 'Observações muito longas.'; end if;

  insert into public.pmoc_plans (
    client_id, company_name, site_name, cep, cidade,
    equipment_count, interval_months, notes
  ) values (
    v_uid, btrim(p_company_name), btrim(p_site_name), v_cep, btrim(p_cidade),
    p_equipment_count, p_interval_months, nullif(btrim(coalesce(p_notes, '')), '')
  ) returning id into v_id;

  insert into public.pmoc_plan_events (plan_id, actor_id, event_type)
  values (v_id, v_uid, 'requested');
  return v_id;
end;
$$;

revoke all on function public.solicitar_pmoc(text, text, text, text, integer, integer, text)
  from public, anon;
grant execute on function public.solicitar_pmoc(text, text, text, text, integer, integer, text)
  to authenticated;

create or replace function public.atribuir_pmoc(
  p_plan_id uuid,
  p_professional_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.pmoc_plans%rowtype;
begin
  if not (select public.eh_admin()) then raise exception 'Acesso restrito a administradores.'; end if;
  select * into v_plan from public.pmoc_plans where id = p_plan_id for update;
  if not found then raise exception 'Solicitação PMOC não encontrada.'; end if;
  if v_plan.status <> 'requested' then raise exception 'PMOC não está aguardando atribuição.'; end if;
  if not exists (
    select 1 from public.professionals pr
     where pr.id = p_professional_id
       and pr.verification_status = 'verificado'
       and public.profissional_atende_cep(pr.id, v_plan.cep)
       and exists (
         select 1 from public.professional_tags pt
          where pt.professional_id = pr.id and pt.tag_slug = 'pmoc'
       )
  ) then raise exception 'Profissional não está elegível para este PMOC.'; end if;

  update public.pmoc_plans
     set professional_id = p_professional_id, status = 'offered'
   where id = p_plan_id;
  insert into public.pmoc_plan_events (plan_id, actor_id, event_type, metadata)
  values (p_plan_id, (select auth.uid()), 'assigned', jsonb_build_object('professional_id', p_professional_id));
  perform public.enqueue_notification(
    p_professional_id, 'pmoc_offered', 'pmoc_plan', p_plan_id,
    jsonb_build_object('company_name', v_plan.company_name, 'site_name', v_plan.site_name),
    format('pmoc-offered:%s:%s', p_plan_id, p_professional_id)
  );
end;
$$;

revoke all on function public.atribuir_pmoc(uuid, uuid) from public, anon;
grant execute on function public.atribuir_pmoc(uuid, uuid) to authenticated;

create or replace function public.responder_pmoc(
  p_plan_id uuid,
  p_accept boolean,
  p_price_per_visit numeric default null,
  p_first_due_date date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_plan public.pmoc_plans%rowtype;
begin
  select * into v_plan from public.pmoc_plans where id = p_plan_id for update;
  if not found then raise exception 'Solicitação PMOC não encontrada.'; end if;
  if v_uid is null or v_plan.professional_id is distinct from v_uid then raise exception 'Acesso negado.'; end if;
  if v_plan.status <> 'offered' then raise exception 'PMOC não está aguardando resposta.'; end if;

  if not coalesce(p_accept, false) then
    update public.pmoc_plans set professional_id = null, status = 'requested' where id = p_plan_id;
    insert into public.pmoc_plan_events (plan_id, actor_id, event_type)
    values (p_plan_id, v_uid, 'declined');
    return;
  end if;

  if coalesce(p_price_per_visit, 0) <= 0 then raise exception 'Informe o valor por visita.'; end if;
  if p_first_due_date is null or p_first_due_date < current_date
     or p_first_due_date > current_date + 365 then
    raise exception 'Data da primeira visita inválida.';
  end if;

  update public.pmoc_plans
     set status = 'active', price_per_visit = round(p_price_per_visit, 2),
         next_due_date = (p_first_due_date + make_interval(months => interval_months))::date
   where id = p_plan_id;
  insert into public.pmoc_visits (plan_id, due_date) values (p_plan_id, p_first_due_date);
  insert into public.pmoc_plan_events (plan_id, actor_id, event_type, metadata)
  values (p_plan_id, v_uid, 'accepted', jsonb_build_object(
    'price_per_visit', round(p_price_per_visit, 2), 'first_due_date', p_first_due_date
  ));
  perform public.enqueue_notification(
    v_plan.client_id, 'pmoc_activated', 'pmoc_plan', p_plan_id,
    jsonb_build_object('first_due_date', p_first_due_date, 'price_per_visit', round(p_price_per_visit, 2)),
    format('pmoc-activated:%s', p_plan_id)
  );
end;
$$;

revoke all on function public.responder_pmoc(uuid, boolean, numeric, date) from public, anon;
grant execute on function public.responder_pmoc(uuid, boolean, numeric, date) to authenticated;

create or replace function public.concluir_visita_pmoc(
  p_visit_id uuid,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_visit public.pmoc_visits%rowtype;
  v_plan public.pmoc_plans%rowtype;
begin
  select * into v_visit from public.pmoc_visits where id = p_visit_id for update;
  if not found then raise exception 'Visita PMOC não encontrada.'; end if;
  select * into v_plan from public.pmoc_plans where id = v_visit.plan_id;
  if v_uid is null or v_plan.professional_id is distinct from v_uid then raise exception 'Acesso negado.'; end if;
  if v_visit.status <> 'planned' then raise exception 'Visita PMOC não está pendente.'; end if;
  if char_length(coalesce(p_notes, '')) > 4000 then raise exception 'Observações muito longas.'; end if;

  update public.pmoc_visits
     set status = 'completed', completed_at = now(), completion_notes = nullif(btrim(coalesce(p_notes, '')), '')
   where id = p_visit_id;
  insert into public.pmoc_plan_events (plan_id, actor_id, event_type, metadata)
  values (v_plan.id, v_uid, 'visit_completed', jsonb_build_object('visit_id', p_visit_id));
end;
$$;

revoke all on function public.concluir_visita_pmoc(uuid, text) from public, anon;
grant execute on function public.concluir_visita_pmoc(uuid, text) to authenticated;

create or replace function public.cancelar_pmoc(p_plan_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_plan public.pmoc_plans%rowtype;
begin
  select * into v_plan from public.pmoc_plans where id = p_plan_id for update;
  if not found then raise exception 'PMOC não encontrado.'; end if;
  if v_uid is null or (v_plan.client_id is distinct from v_uid and not (select public.eh_admin())) then
    raise exception 'Acesso negado.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Informe o motivo do cancelamento.'; end if;
  if v_plan.status = 'cancelled' then return; end if;
  update public.pmoc_plans set status = 'cancelled', next_due_date = null where id = p_plan_id;
  update public.pmoc_visits set status = 'cancelled'
   where plan_id = p_plan_id and status = 'planned';
  insert into public.pmoc_plan_events (plan_id, actor_id, event_type, metadata)
  values (p_plan_id, v_uid, 'cancelled', jsonb_build_object('reason', left(btrim(p_reason), 500)));
end;
$$;

revoke all on function public.cancelar_pmoc(uuid, text) from public, anon;
grant execute on function public.cancelar_pmoc(uuid, text) to authenticated;

create or replace function public.processar_pmoc_recorrente()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan record;
  v_visit_id uuid;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('friohub:pmoc-recorrente', 0)) then return; end if;

  for v_plan in
    select * from public.pmoc_plans
     where status = 'active'
       and next_due_date <= current_date + 30
     order by next_due_date
     for update skip locked
  loop
    insert into public.pmoc_visits (plan_id, due_date)
    values (v_plan.id, v_plan.next_due_date)
    on conflict (plan_id, due_date) do update set due_date = excluded.due_date
    returning id into v_visit_id;

    insert into public.pmoc_plan_events (plan_id, event_type, metadata)
    values (v_plan.id, 'visit_created', jsonb_build_object(
      'visit_id', v_visit_id, 'due_date', v_plan.next_due_date
    ));

    perform public.enqueue_notification(
      v_plan.client_id, 'pmoc_visit_due', 'pmoc_visit', v_visit_id,
      jsonb_build_object('due_date', v_plan.next_due_date, 'site_name', v_plan.site_name),
      format('pmoc-visit-due:client:%s', v_visit_id)
    );
    perform public.enqueue_notification(
      v_plan.professional_id, 'pmoc_visit_due', 'pmoc_visit', v_visit_id,
      jsonb_build_object('due_date', v_plan.next_due_date, 'site_name', v_plan.site_name),
      format('pmoc-visit-due:professional:%s', v_visit_id)
    );

    update public.pmoc_plans
       set next_due_date = (v_plan.next_due_date + make_interval(months => v_plan.interval_months))::date
     where id = v_plan.id;
  end loop;
end;
$$;

revoke all on function public.processar_pmoc_recorrente() from public, anon, authenticated;

select cron.schedule(
  'friohub-pmoc-recorrente',
  '15 11 * * *',
  'select public.processar_pmoc_recorrente();'
);
