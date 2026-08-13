-- Fase UX 2 — tarefas de follow-up do profissional.
-- O estágio comercial continua derivado de quote_request/quote/job; esta tabela
-- registra apenas a próxima ação, sem copiar o estado da oportunidade.

create table public.follow_up_tasks (
  id               uuid primary key default gen_random_uuid(),
  professional_id  uuid not null references public.professionals (id) on delete restrict,
  quote_request_id uuid not null references public.quote_requests (id) on delete restrict,
  title            text not null check (char_length(title) between 2 and 160),
  due_at           timestamptz not null,
  status           text not null default 'pending'
                   check (status in ('pending', 'completed', 'cancelled')),
  outcome          text check (outcome is null or outcome in (
                     'contacted', 'no_response', 'converted', 'lost', 'rescheduled', 'other'
                   )),
  notes            text check (notes is null or char_length(notes) <= 1000),
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index uq_follow_up_pending_per_opportunity
  on public.follow_up_tasks (professional_id, quote_request_id)
  where status = 'pending';
create index idx_follow_up_professional_due
  on public.follow_up_tasks (professional_id, due_at)
  where status = 'pending';

create table public.follow_up_events (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.follow_up_tasks (id) on delete restrict,
  actor_id    uuid references public.profiles (id) on delete set null,
  event_type  text not null check (event_type in ('created', 'rescheduled', 'completed', 'cancelled')),
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index idx_follow_up_events_task on public.follow_up_events (task_id, created_at);

alter table public.follow_up_tasks enable row level security;
alter table public.follow_up_events enable row level security;

create policy "follow_up_tasks_owner_read" on public.follow_up_tasks
  for select to authenticated
  using (professional_id = (select auth.uid()) or (select public.eh_admin()));
create policy "follow_up_events_owner_read" on public.follow_up_events
  for select to authenticated
  using (exists (
    select 1 from public.follow_up_tasks task
     where task.id = task_id
       and (task.professional_id = (select auth.uid()) or (select public.eh_admin()))
  ));

grant select on public.follow_up_tasks, public.follow_up_events to authenticated;
revoke all on public.follow_up_tasks, public.follow_up_events from anon;
revoke insert, update, delete on public.follow_up_tasks, public.follow_up_events from authenticated;

create trigger trg_follow_up_tasks_touch before update on public.follow_up_tasks
  for each row execute function public.touch_updated_at();

create or replace function public.bloqueia_follow_up_evento()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Histórico de follow-up é imutável.';
end;
$$;

revoke all on function public.bloqueia_follow_up_evento() from public, anon, authenticated;
create trigger trg_follow_up_events_immutable before update or delete on public.follow_up_events
  for each row execute function public.bloqueia_follow_up_evento();

create or replace function public.criar_follow_up(
  p_quote_request_id uuid,
  p_due_at timestamptz,
  p_title text default 'Retornar contato'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null or not exists (
    select 1 from public.quote_request_targets target
     where target.quote_request_id = p_quote_request_id
       and target.professional_id = v_uid
  ) then raise exception 'Acesso negado à oportunidade.'; end if;
  if p_due_at is null or p_due_at < now() - interval '5 minutes'
     or p_due_at > now() + interval '1 year' then
    raise exception 'Data de follow-up inválida.';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 2 and 160 then
    raise exception 'Informe um título válido.';
  end if;

  insert into public.follow_up_tasks (professional_id, quote_request_id, title, due_at)
  values (v_uid, p_quote_request_id, btrim(p_title), p_due_at)
  returning id into v_id;
  insert into public.follow_up_events (task_id, actor_id, event_type, metadata)
  values (v_id, v_uid, 'created', jsonb_build_object('due_at', p_due_at));
  return v_id;
end;
$$;

create or replace function public.adiar_follow_up(p_task_id uuid, p_due_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if p_due_at is null or p_due_at < now() or p_due_at > now() + interval '1 year' then
    raise exception 'Data de follow-up inválida.';
  end if;
  update public.follow_up_tasks set due_at = p_due_at
   where id = p_task_id and professional_id = v_uid and status = 'pending';
  if not found then raise exception 'Follow-up pendente não encontrado.'; end if;
  insert into public.follow_up_events (task_id, actor_id, event_type, metadata)
  values (p_task_id, v_uid, 'rescheduled', jsonb_build_object('due_at', p_due_at));
end;
$$;

create or replace function public.concluir_follow_up(
  p_task_id uuid,
  p_outcome text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if p_outcome not in ('contacted', 'no_response', 'converted', 'lost', 'rescheduled', 'other') then
    raise exception 'Resultado de follow-up inválido.';
  end if;
  if char_length(coalesce(p_notes, '')) > 1000 then raise exception 'Observações muito longas.'; end if;
  update public.follow_up_tasks
     set status = 'completed', outcome = p_outcome,
         notes = nullif(btrim(coalesce(p_notes, '')), ''), completed_at = now()
   where id = p_task_id and professional_id = v_uid and status = 'pending';
  if not found then raise exception 'Follow-up pendente não encontrado.'; end if;
  insert into public.follow_up_events (task_id, actor_id, event_type, metadata)
  values (p_task_id, v_uid, 'completed', jsonb_build_object('outcome', p_outcome));
end;
$$;

revoke all on function public.criar_follow_up(uuid, timestamptz, text) from public, anon;
revoke all on function public.adiar_follow_up(uuid, timestamptz) from public, anon;
revoke all on function public.concluir_follow_up(uuid, text, text) from public, anon;
grant execute on function public.criar_follow_up(uuid, timestamptz, text) to authenticated;
grant execute on function public.adiar_follow_up(uuid, timestamptz) to authenticated;
grant execute on function public.concluir_follow_up(uuid, text, text) to authenticated;

comment on table public.follow_up_tasks is
  'Próxima ação comercial do profissional; não duplica o estágio derivado da oportunidade.';
