-- ============================================================================
-- FASE 2 — CHAT CONTEXTUAL E AGENDAMENTO DO SERVIÇO
-- ============================================================================

set lock_timeout = '5s';
set statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 1. Contexto da conversa sem duplicar threads entre o mesmo par
-- ---------------------------------------------------------------------------
create table public.conversation_contexts (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  quote_request_id uuid references public.quote_requests (id) on delete cascade,
  job_id            uuid references public.jobs (id) on delete cascade,
  created_at        timestamptz not null default now(),
  check (num_nonnulls(quote_request_id, job_id) = 1)
);

create unique index uq_conversation_context_quote_request
  on public.conversation_contexts (conversation_id, quote_request_id)
  where quote_request_id is not null;
create unique index uq_conversation_context_job
  on public.conversation_contexts (conversation_id, job_id)
  where job_id is not null;

alter table public.conversation_contexts enable row level security;
create policy "conversation_contexts_participant_read"
  on public.conversation_contexts for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
       where c.id = conversation_id
         and (select auth.uid()) in (c.cliente_id, c.professional_id)
    )
  );

grant select on public.conversation_contexts to authenticated;
revoke insert, update, delete on public.conversation_contexts from anon, authenticated;

create or replace function public.abrir_conversa_contextual(
  p_professional_id uuid,
  p_quote_request_id uuid default null,
  p_job_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cliente_id uuid;
  v_profissional_id uuid;
  v_conversation_id uuid;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if num_nonnulls(p_quote_request_id, p_job_id) > 1 then
    raise exception 'Informe apenas um contexto para a conversa.';
  end if;

  if p_job_id is not null then
    select j.cliente_id, j.profissional_id
      into v_cliente_id, v_profissional_id
      from public.jobs j where j.id = p_job_id;

    if not found or v_profissional_id is null
       or v_profissional_id is distinct from p_professional_id
       or v_uid not in (v_cliente_id, v_profissional_id) then
      raise exception 'Serviço não encontrado ou acesso negado.';
    end if;

  elsif p_quote_request_id is not null then
    select q.cliente_id, t.professional_id
      into v_cliente_id, v_profissional_id
      from public.quote_requests q
      join public.quote_request_targets t on t.quote_request_id = q.id
     where q.id = p_quote_request_id
       and t.professional_id = p_professional_id;

    if not found or v_uid not in (v_cliente_id, v_profissional_id) then
      raise exception 'Pedido não encontrado ou acesso negado.';
    end if;

  else
    if v_uid = p_professional_id
       or not exists (select 1 from public.professionals p where p.id = p_professional_id)
       or not exists (
         select 1 from public.profiles p where p.id = v_uid and p.role = 'cliente'
       ) then
      raise exception 'Conversa sem contexto só pode ser iniciada por um cliente.';
    end if;
    v_cliente_id := v_uid;
    v_profissional_id := p_professional_id;
  end if;

  insert into public.conversations (cliente_id, professional_id, job_id)
  values (v_cliente_id, v_profissional_id, p_job_id)
  on conflict (cliente_id, professional_id) do update
    set job_id = coalesce(excluded.job_id, conversations.job_id)
  returning id into v_conversation_id;

  if p_quote_request_id is not null then
    insert into public.conversation_contexts (conversation_id, quote_request_id)
    values (v_conversation_id, p_quote_request_id)
    on conflict (conversation_id, quote_request_id) where quote_request_id is not null do nothing;
  elsif p_job_id is not null then
    insert into public.conversation_contexts (conversation_id, job_id)
    values (v_conversation_id, p_job_id)
    on conflict (conversation_id, job_id) where job_id is not null do nothing;
  end if;

  return v_conversation_id;
end;
$$;

revoke all on function public.abrir_conversa_contextual(uuid, uuid, uuid) from public, anon;
grant execute on function public.abrir_conversa_contextual(uuid, uuid, uuid) to authenticated;

-- Compatibilidade com os cards de profissional que ainda abrem chat sem contexto.
create or replace function public.abrir_conversa(p_professional_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.abrir_conversa_contextual(p_professional_id, null, null);
$$;

revoke all on function public.abrir_conversa(uuid) from public, anon;
grant execute on function public.abrir_conversa(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Proposta, confirmação e cancelamento de horário
-- ---------------------------------------------------------------------------
alter table public.notification_outbox
  drop constraint notification_outbox_event_type_check,
  add constraint notification_outbox_event_type_check check (event_type in (
    'quote_request_received', 'quote_received', 'quote_accepted',
    'quote_cancelled', 'quote_declined', 'new_message', 'job_updated',
    'appointment_proposed', 'appointment_confirmed', 'appointment_cancelled',
    'appointment_reminder'
  ));

-- Inclui cancelamentos de agenda na mesma preferência de lembretes. A função é
-- repetida aqui para que upgrades incrementais tenham o mesmo comportamento de
-- um banco criado do zero com a migration anterior já corrigida.
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
      when p_event_type in (
        'appointment_proposed', 'appointment_confirmed',
        'appointment_cancelled', 'appointment_reminder'
      ) then np.reminders
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

create table public.job_appointments (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.jobs (id) on delete cascade,
  proposed_by    uuid not null references public.profiles (id) on delete restrict,
  confirmed_by   uuid references public.profiles (id) on delete set null,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  status         text not null default 'proposed'
                 check (status in ('proposed', 'confirmed', 'cancelled')),
  notes          text check (notes is null or char_length(notes) <= 1000),
  cancellation_reason text check (
    cancellation_reason is null or char_length(cancellation_reason) between 3 and 500
  ),
  confirmed_at   timestamptz,
  cancelled_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at <= starts_at + interval '12 hours')
);

create unique index uq_job_appointment_active
  on public.job_appointments (job_id)
  where status in ('proposed', 'confirmed');
create index idx_job_appointments_reminders
  on public.job_appointments (starts_at)
  where status = 'confirmed';

alter table public.job_appointments enable row level security;
create policy "job_appointments_participant_read"
  on public.job_appointments for select to authenticated
  using (
    exists (
      select 1 from public.jobs j
       where j.id = job_id
         and ((select auth.uid()) in (j.cliente_id, j.profissional_id) or (select public.eh_admin()))
    )
  );

grant select on public.job_appointments to authenticated;
revoke insert, update, delete on public.job_appointments from anon, authenticated;

create trigger trg_job_appointments_touch
  before update on public.job_appointments
  for each row execute function public.touch_updated_at();

create or replace function public.propor_agendamento(
  p_job_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_job public.jobs%rowtype;
  v_id uuid;
  v_recipient uuid;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if p_starts_at < now() + interval '30 minutes' then
    raise exception 'Escolha um horário com pelo menos 30 minutos de antecedência.';
  end if;
  if p_ends_at <= p_starts_at or p_ends_at > p_starts_at + interval '12 hours' then
    raise exception 'A duração do serviço deve ficar entre alguns minutos e 12 horas.';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if not found or v_uid not in (v_job.cliente_id, v_job.profissional_id) then
    raise exception 'Serviço não encontrado ou acesso negado.';
  end if;
  if v_job.profissional_id is null or v_job.status not in ('aguardando_profissional', 'aceito') then
    raise exception 'Este serviço não aceita novo agendamento no estado atual.';
  end if;
  if exists (
    select 1 from public.job_appointments
     where job_id = p_job_id and status = 'confirmed'
  ) then
    raise exception 'Já existe um horário confirmado. Cancele-o antes de propor outro.';
  end if;

  update public.job_appointments
     set status = 'cancelled', cancelled_at = now(),
         cancellation_reason = 'Substituído por uma nova proposta de horário.'
   where job_id = p_job_id and status = 'proposed';

  insert into public.job_appointments (
    job_id, proposed_by, starts_at, ends_at, notes
  ) values (
    p_job_id, v_uid, p_starts_at, p_ends_at, nullif(btrim(p_notes), '')
  ) returning id into v_id;

  v_recipient := case when v_uid = v_job.cliente_id
    then v_job.profissional_id else v_job.cliente_id end;

  insert into public.job_events (job_id, actor_id, event_type, metadata)
  values (p_job_id, v_uid, 'appointment_proposed', jsonb_build_object(
    'appointment_id', v_id, 'starts_at', p_starts_at, 'ends_at', p_ends_at
  ));

  perform public.enqueue_notification(
    v_recipient, 'appointment_proposed', 'appointment', v_id,
    jsonb_build_object('job_id', p_job_id, 'starts_at', p_starts_at, 'ends_at', p_ends_at),
    format('appointment-proposed:%s', v_id)
  );

  return v_id;
end;
$$;

revoke all on function public.propor_agendamento(uuid, timestamptz, timestamptz, text)
  from public, anon;
grant execute on function public.propor_agendamento(uuid, timestamptz, timestamptz, text)
  to authenticated;

create or replace function public.responder_agendamento(
  p_appointment_id uuid,
  p_accept boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_appointment public.job_appointments%rowtype;
  v_job public.jobs%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;

  select * into v_appointment from public.job_appointments
   where id = p_appointment_id for update;
  if not found then raise exception 'Agendamento não encontrado.'; end if;

  select * into v_job from public.jobs where id = v_appointment.job_id;
  if v_uid not in (v_job.cliente_id, v_job.profissional_id)
     or v_uid = v_appointment.proposed_by then
    raise exception 'Somente a outra parte pode responder a esta proposta.';
  end if;
  if v_appointment.status <> 'proposed' then
    raise exception 'Esta proposta de horário já foi respondida.';
  end if;
  if not p_accept and (v_reason is null or char_length(v_reason) < 3) then
    raise exception 'Informe brevemente o motivo da recusa.';
  end if;

  if p_accept then
    update public.job_appointments
       set status = 'confirmed', confirmed_by = v_uid, confirmed_at = now()
     where id = p_appointment_id;
  else
    update public.job_appointments
       set status = 'cancelled', cancelled_at = now(), cancellation_reason = v_reason
     where id = p_appointment_id;
  end if;

  insert into public.job_events (job_id, actor_id, event_type, reason, metadata)
  values (
    v_job.id, v_uid,
    case when p_accept then 'appointment_confirmed' else 'appointment_declined' end,
    v_reason,
    jsonb_build_object('appointment_id', p_appointment_id)
  );

  perform public.enqueue_notification(
    v_appointment.proposed_by,
    case when p_accept then 'appointment_confirmed' else 'appointment_cancelled' end,
    'appointment', p_appointment_id,
    jsonb_build_object('job_id', v_job.id, 'starts_at', v_appointment.starts_at, 'reason', v_reason),
    format('appointment-response:%s', p_appointment_id)
  );
end;
$$;

revoke all on function public.responder_agendamento(uuid, boolean, text) from public, anon;
grant execute on function public.responder_agendamento(uuid, boolean, text) to authenticated;

create or replace function public.cancelar_agendamento(
  p_appointment_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_appointment public.job_appointments%rowtype;
  v_job public.jobs%rowtype;
  v_recipient uuid;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'Informe brevemente o motivo do cancelamento.';
  end if;

  select * into v_appointment from public.job_appointments
   where id = p_appointment_id for update;
  if not found then raise exception 'Agendamento não encontrado.'; end if;
  select * into v_job from public.jobs where id = v_appointment.job_id;

  if v_uid not in (v_job.cliente_id, v_job.profissional_id) then
    raise exception 'Acesso negado.';
  end if;
  if v_appointment.status not in ('proposed', 'confirmed') then return; end if;

  update public.job_appointments
     set status = 'cancelled', cancelled_at = now(), cancellation_reason = v_reason
   where id = p_appointment_id;

  v_recipient := case when v_uid = v_job.cliente_id
    then v_job.profissional_id else v_job.cliente_id end;

  insert into public.job_events (job_id, actor_id, event_type, reason, metadata)
  values (v_job.id, v_uid, 'appointment_cancelled', v_reason,
          jsonb_build_object('appointment_id', p_appointment_id));

  perform public.enqueue_notification(
    v_recipient, 'appointment_cancelled', 'appointment', p_appointment_id,
    jsonb_build_object('job_id', v_job.id, 'starts_at', v_appointment.starts_at, 'reason', v_reason),
    format('appointment-cancelled:%s', p_appointment_id)
  );
end;
$$;

revoke all on function public.cancelar_agendamento(uuid, text) from public, anon;
grant execute on function public.cancelar_agendamento(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Lembretes idempotentes (24 h e 2 h antes)
-- ---------------------------------------------------------------------------
create or replace function public.processar_lembretes_agendamento()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_recipient uuid;
  v_window text;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('friohub:appointment-reminders', 0)) then
    return;
  end if;

  for v_item in
    select a.id, a.job_id, a.starts_at, j.cliente_id, j.profissional_id,
           case
             when a.starts_at <= now() + interval '2 hours' then '2h'
             else '24h'
           end as reminder_window
      from public.job_appointments a
      join public.jobs j on j.id = a.job_id
     where a.status = 'confirmed'
       and a.starts_at > now()
       and a.starts_at <= now() + interval '24 hours'
  loop
    v_window := v_item.reminder_window;
    foreach v_recipient in array array[v_item.cliente_id, v_item.profissional_id]
    loop
      perform public.enqueue_notification(
        v_recipient, 'appointment_reminder', 'appointment', v_item.id,
        jsonb_build_object(
          'job_id', v_item.job_id,
          'starts_at', v_item.starts_at,
          'window', v_window
        ),
        format('appointment-reminder:%s:%s:%s', v_item.id, v_recipient, v_window)
      );
    end loop;
  end loop;
end;
$$;

revoke all on function public.processar_lembretes_agendamento()
  from public, anon, authenticated;

select cron.schedule(
  'friohub-appointment-reminders',
  '*/5 * * * *',
  'select public.processar_lembretes_agendamento();'
);
