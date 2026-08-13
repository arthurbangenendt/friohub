-- ============================================================================
-- FASE 2 — NÚCLEO OPERACIONAL DO MARKETPLACE
--
-- Preferências, outbox idempotente, histórico de RFQ/job, expiração automática
-- e fila de exceções. O envio externo consome a outbox em migration/função
-- separada para não acoplar regra de negócio ao fornecedor de e-mail.
-- ============================================================================

set lock_timeout = '5s';
set statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 1. Preferências e outbox de notificações
-- ---------------------------------------------------------------------------
create table public.notification_preferences (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  email_enabled    boolean not null default true,
  quote_requests   boolean not null default true,
  quotes           boolean not null default true,
  job_updates      boolean not null default true,
  messages         boolean not null default true,
  reminders        boolean not null default true,
  updated_at       timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

create policy "notification_preferences_self_select"
  on public.notification_preferences for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "notification_preferences_self_insert"
  on public.notification_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "notification_preferences_self_update"
  on public.notification_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.notification_preferences to authenticated;
revoke all on public.notification_preferences from anon;

create trigger trg_notification_preferences_touch
  before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

create table public.notification_outbox (
  id             uuid primary key default gen_random_uuid(),
  recipient_id   uuid not null references public.profiles (id) on delete cascade,
  event_type     text not null check (event_type in (
    'quote_request_received', 'quote_received', 'quote_accepted',
    'quote_cancelled', 'quote_declined', 'new_message', 'job_updated',
    'appointment_proposed', 'appointment_confirmed', 'appointment_reminder'
  )),
  aggregate_type text not null check (aggregate_type in ('quote_request', 'job', 'conversation', 'appointment')),
  aggregate_id   uuid not null,
  payload        jsonb not null default '{}'::jsonb,
  dedupe_key     text not null unique,
  status         text not null default 'pending'
                 check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts       integer not null default 0 check (attempts >= 0),
  available_at   timestamptz not null default now(),
  locked_at      timestamptz,
  sent_at        timestamptz,
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index idx_notification_outbox_pending
  on public.notification_outbox (available_at, created_at)
  where status in ('pending', 'failed');

alter table public.notification_outbox enable row level security;
create policy "notification_outbox_admin_read"
  on public.notification_outbox for select to authenticated
  using ((select public.eh_admin()));

grant select on public.notification_outbox to authenticated;
revoke insert, update, delete on public.notification_outbox from anon, authenticated;

create trigger trg_notification_outbox_touch
  before update on public.notification_outbox
  for each row execute function public.touch_updated_at();

create or replace function public.enqueue_notification(
  p_recipient_id uuid,
  p_event_type text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_payload jsonb,
  p_dedupe_key text,
  p_available_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean := true;
  v_id uuid;
begin
  if p_recipient_id is null then return null; end if;

  select np.email_enabled and case
      when p_event_type = 'quote_request_received' then np.quote_requests
      when p_event_type in ('quote_received', 'quote_accepted', 'quote_cancelled', 'quote_declined') then np.quotes
      when p_event_type = 'new_message' then np.messages
      when p_event_type in ('appointment_proposed', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder') then np.reminders
      else np.job_updates
    end
    into v_enabled
    from public.notification_preferences np
   where np.user_id = p_recipient_id;

  if not coalesce(v_enabled, true) then return null; end if;

  insert into public.notification_outbox (
    recipient_id, event_type, aggregate_type, aggregate_id,
    payload, dedupe_key, available_at
  ) values (
    p_recipient_id, p_event_type, p_aggregate_type, p_aggregate_id,
    coalesce(p_payload, '{}'::jsonb), p_dedupe_key, coalesce(p_available_at, now())
  )
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.enqueue_notification(uuid, text, text, uuid, jsonb, text, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Histórico imutável de orçamento e serviço
-- ---------------------------------------------------------------------------
create table public.quote_request_events (
  id               uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests (id) on delete cascade,
  actor_id         uuid references public.profiles (id) on delete set null,
  event_type       text not null,
  reason           text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index idx_quote_request_events_request
  on public.quote_request_events (quote_request_id, created_at desc);

alter table public.quote_request_events enable row level security;
create policy "quote_request_events_participant_read"
  on public.quote_request_events for select to authenticated
  using (
    (select public.dono_do_pedido(quote_request_id))
    or (select public.destinatario_do_pedido(quote_request_id))
    or (select public.eh_admin())
  );

grant select on public.quote_request_events to authenticated;
revoke insert, update, delete on public.quote_request_events from anon, authenticated;

create table public.job_events (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references public.jobs (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  event_type text not null,
  from_status text,
  to_status   text,
  reason      text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index idx_job_events_job on public.job_events (job_id, created_at desc);

alter table public.job_events enable row level security;
create policy "job_events_participant_read"
  on public.job_events for select to authenticated
  using (
    exists (
      select 1 from public.jobs j
       where j.id = job_id
         and ((select auth.uid()) in (j.cliente_id, j.profissional_id) or (select public.eh_admin()))
    )
  );

grant select on public.job_events to authenticated;
revoke insert, update, delete on public.job_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Cancelamento e recusa passam a ser comandos auditados
-- ---------------------------------------------------------------------------
drop policy if exists "qr_cliente_update" on public.quote_requests;
drop policy if exists "qrt_pro_update" on public.quote_request_targets;

create or replace function public.cancelar_pedido_orcamento(
  p_quote_request_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_req public.quote_requests%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_target record;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if v_reason is null or char_length(v_reason) < 5 then
    raise exception 'Informe o motivo do cancelamento com pelo menos cinco caracteres.';
  end if;

  select * into v_req from public.quote_requests
   where id = p_quote_request_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_req.cliente_id is distinct from v_uid then raise exception 'Acesso negado.'; end if;
  if v_req.status = 'cancelado' then return; end if;
  if v_req.status <> 'aberto' then raise exception 'Somente pedidos abertos podem ser cancelados.'; end if;

  update public.quote_requests set status = 'cancelado' where id = v_req.id;
  insert into public.quote_request_events (quote_request_id, actor_id, event_type, reason)
  values (v_req.id, v_uid, 'cancelled', v_reason);

  for v_target in
    select professional_id from public.quote_request_targets where quote_request_id = v_req.id
  loop
    perform public.enqueue_notification(
      v_target.professional_id, 'quote_cancelled', 'quote_request', v_req.id,
      jsonb_build_object('reason', v_reason),
      format('quote-cancelled:%s:%s', v_req.id, v_target.professional_id)
    );
  end loop;
end;
$$;

revoke all on function public.cancelar_pedido_orcamento(uuid, text) from public, anon;
grant execute on function public.cancelar_pedido_orcamento(uuid, text) to authenticated;

create or replace function public.recusar_pedido_orcamento(
  p_quote_request_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_req public.quote_requests%rowtype;
  v_target public.quote_request_targets%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'Informe brevemente o motivo da recusa.';
  end if;

  select * into v_req from public.quote_requests
   where id = p_quote_request_id for share;
  if not found or v_req.status <> 'aberto' or v_req.expira_em <= now() then
    raise exception 'Pedido não está mais disponível.';
  end if;

  select * into v_target from public.quote_request_targets
   where quote_request_id = p_quote_request_id and professional_id = v_uid
   for update;
  if not found then raise exception 'Você não recebeu este pedido.'; end if;
  if v_target.recusado_em is not null then return; end if;

  update public.quote_request_targets
     set recusado_em = now(), visto_em = coalesce(visto_em, now()), motivo_recusa = v_reason
   where quote_request_id = p_quote_request_id and professional_id = v_uid;

  insert into public.quote_request_events (
    quote_request_id, actor_id, event_type, reason, metadata
  ) values (
    p_quote_request_id, v_uid, 'declined', v_reason,
    jsonb_build_object('professional_id', v_uid)
  );

  perform public.enqueue_notification(
    v_req.cliente_id, 'quote_declined', 'quote_request', v_req.id,
    jsonb_build_object('professional_id', v_uid, 'reason', v_reason),
    format('quote-declined:%s:%s', v_req.id, v_uid)
  );
end;
$$;

revoke all on function public.recusar_pedido_orcamento(uuid, text) from public, anon;
grant execute on function public.recusar_pedido_orcamento(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Gatilhos transacionais da outbox
-- ---------------------------------------------------------------------------
create or replace function public.notifica_novo_destinatario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_notification(
    new.professional_id, 'quote_request_received', 'quote_request', new.quote_request_id,
    '{}'::jsonb,
    format('quote-request:%s:%s', new.quote_request_id, new.professional_id)
  );
  return new;
end;
$$;

create trigger trg_quote_target_notification
  after insert on public.quote_request_targets
  for each row execute function public.notifica_novo_destinatario();

create or replace function public.notifica_nova_proposta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente uuid;
begin
  select cliente_id into v_cliente from public.quote_requests where id = new.quote_request_id;
  perform public.enqueue_notification(
    v_cliente, 'quote_received', 'quote_request', new.quote_request_id,
    jsonb_build_object('quote_id', new.id, 'professional_id', new.professional_id),
    format('quote-received:%s', new.id)
  );
  return new;
end;
$$;

create trigger trg_quote_notification
  after insert on public.quotes
  for each row execute function public.notifica_nova_proposta();

create or replace function public.notifica_job_criado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_notification(
    new.profissional_id, 'quote_accepted', 'job', new.id,
    jsonb_build_object('quote_request_id', new.quote_request_id),
    format('quote-accepted:%s', new.id)
  );
  insert into public.job_events (job_id, actor_id, event_type, to_status)
  values (new.id, new.cliente_id, 'created_from_quote', new.status);
  return new;
end;
$$;

create trigger trg_job_created_notification
  after insert on public.jobs
  for each row execute function public.notifica_job_criado();

create or replace function public.notifica_job_atualizado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
begin
  if new.status is not distinct from old.status then return new; end if;
  v_recipient := case
    when (select auth.uid()) = new.cliente_id then new.profissional_id
    else new.cliente_id
  end;

  insert into public.job_events (
    job_id, actor_id, event_type, from_status, to_status
  ) values (
    new.id, (select auth.uid()), 'status_changed', old.status, new.status
  );

  perform public.enqueue_notification(
    v_recipient, 'job_updated', 'job', new.id,
    jsonb_build_object('from_status', old.status, 'to_status', new.status),
    format('job-status:%s:%s', new.id, new.status)
  );
  return new;
end;
$$;

create trigger trg_job_status_notification
  after update of status on public.jobs
  for each row execute function public.notifica_job_atualizado();

create or replace function public.notifica_nova_mensagem()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv public.conversations%rowtype;
  v_recipient uuid;
  v_bucket bigint;
begin
  select * into v_conv from public.conversations where id = new.conversation_id;
  v_recipient := case when new.sender_id = v_conv.cliente_id
    then v_conv.professional_id else v_conv.cliente_id end;
  v_bucket := floor(extract(epoch from new.created_at) / 300);

  perform public.enqueue_notification(
    v_recipient, 'new_message', 'conversation', new.conversation_id,
    jsonb_build_object('sender_id', new.sender_id),
    format('new-message:%s:%s:%s', new.conversation_id, v_recipient, v_bucket)
  );
  return new;
end;
$$;

create trigger trg_message_notification
  after insert on public.messages
  for each row execute function public.notifica_nova_mensagem();

-- Trigger functions are internal implementation details.
revoke all on function public.notifica_novo_destinatario() from public, anon, authenticated;
revoke all on function public.notifica_nova_proposta() from public, anon, authenticated;
revoke all on function public.notifica_job_criado() from public, anon, authenticated;
revoke all on function public.notifica_job_atualizado() from public, anon, authenticated;
revoke all on function public.notifica_nova_mensagem() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Fila operacional e expiração/SLA
-- ---------------------------------------------------------------------------
create table public.operational_cases (
  id             uuid primary key default gen_random_uuid(),
  case_type      text not null check (case_type in ('quote_without_response', 'job_without_ack')),
  aggregate_type text not null check (aggregate_type in ('quote_request', 'job')),
  aggregate_id   uuid not null,
  priority       text not null default 'normal' check (priority in ('normal', 'high', 'critical')),
  status         text not null default 'open' check (status in ('open', 'resolved')),
  details        jsonb not null default '{}'::jsonb,
  opened_at      timestamptz not null default now(),
  resolved_at    timestamptz,
  updated_at     timestamptz not null default now(),
  unique (case_type, aggregate_type, aggregate_id)
);

create index idx_operational_cases_open
  on public.operational_cases (priority, opened_at)
  where status = 'open';

alter table public.operational_cases enable row level security;
create policy "operational_cases_admin_read"
  on public.operational_cases for select to authenticated
  using ((select public.eh_admin()));

grant select on public.operational_cases to authenticated;
revoke insert, update, delete on public.operational_cases from anon, authenticated;

create trigger trg_operational_cases_touch
  before update on public.operational_cases
  for each row execute function public.touch_updated_at();

create or replace function public.processar_operacao_marketplace()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('friohub:marketplace-ops', 0)) then
    return;
  end if;

  for v_req in
    update public.quote_requests
       set status = 'expirado'
     where status = 'aberto' and expira_em <= now()
    returning id, cliente_id
  loop
    insert into public.quote_request_events (quote_request_id, event_type)
    values (v_req.id, 'expired');
  end loop;

  insert into public.operational_cases (
    case_type, aggregate_type, aggregate_id, priority, details
  )
  select
    'quote_without_response', 'quote_request', q.id,
    case when q.urgencia = 'urgente' then 'critical' else 'high' end,
    jsonb_build_object('created_at', q.created_at, 'urgencia', q.urgencia)
  from public.quote_requests q
  where q.status = 'aberto'
    and q.created_at <= now() - case when q.urgencia = 'urgente' then interval '30 minutes' else interval '2 hours' end
    and not exists (
      select 1 from public.quotes qu
       where qu.quote_request_id = q.id and qu.status in ('enviada', 'aceita')
    )
  on conflict (case_type, aggregate_type, aggregate_id) do update
    set status = 'open', resolved_at = null, priority = excluded.priority, details = excluded.details;

  insert into public.operational_cases (
    case_type, aggregate_type, aggregate_id, priority, details
  )
  select
    'job_without_ack', 'job', j.id, 'high',
    jsonb_build_object('created_at', j.created_at, 'professional_id', j.profissional_id)
  from public.jobs j
  where j.status = 'aguardando_profissional'
    and j.created_at <= now() - interval '2 hours'
  on conflict (case_type, aggregate_type, aggregate_id) do update
    set status = 'open', resolved_at = null, priority = excluded.priority, details = excluded.details;

  update public.operational_cases oc
     set status = 'resolved', resolved_at = now()
   where oc.status = 'open'
     and (
       (oc.case_type = 'quote_without_response' and not exists (
          select 1 from public.quote_requests q
           where q.id = oc.aggregate_id and q.status = 'aberto'
             and not exists (
               select 1 from public.quotes qu
                where qu.quote_request_id = q.id and qu.status in ('enviada', 'aceita')
             )
       ))
       or
       (oc.case_type = 'job_without_ack' and not exists (
          select 1 from public.jobs j
           where j.id = oc.aggregate_id and j.status = 'aguardando_profissional'
       ))
     );
end;
$$;

revoke all on function public.processar_operacao_marketplace() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule(
  'friohub-marketplace-operations',
  '* * * * *',
  'select public.processar_operacao_marketplace();'
);
