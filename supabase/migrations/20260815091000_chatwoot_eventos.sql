-- ============================================================================
-- Chatwoot — inbox de eventos do webhook
--
-- Mesmo desenho de `payment_gateway_events` (20260813172401): o evento chega,
-- é gravado cru e só depois é interpretado. Duas razões, as duas já custaram
-- caro em outros lugares:
--
--   · o Chatwoot reentrega em falha, e reentrega é indistinguível de evento
--     novo se não houver chave. `chatwoot_event_id` é o header
--     `X-Chatwoot-Delivery` (SecureRandom.uuid gerado uma vez por entrega e
--     preservado nas retentativas do Sidekiq). Quando ele faltar, o worker
--     monta uma chave determinística `{event}:{id}:{timestamp}`.
--
--   · interpretar antes de gravar significa perder o evento quando a
--     interpretação falha. Aqui o webhook responde 200 assim que a linha
--     existe, e o processamento pode falhar e ser repetido sem o Chatwoot
--     desistir da entrega.
--
-- A idempotência de EFEITO não depende só desta tabela: espelhar uma mensagem
-- é idempotente pelo `messages.chatwoot_message_id`, que é unique. Esta tabela
-- evita trabalho repetido; o unique evita duplicata de verdade.
--
-- Reversibilidade: tabela nova, `drop table` desfaz.
-- ============================================================================

create table if not exists public.chatwoot_events (
  id                uuid primary key default gen_random_uuid(),
  chatwoot_event_id text not null,
  event_type        text not null,
  payload           jsonb not null,
  occurred_at       timestamptz not null,
  received_at       timestamptz not null default now(),
  processing_status text not null default 'pending'
                    check (processing_status in ('pending', 'processed', 'ignored', 'error')),
  attempts          integer not null default 0 check (attempts >= 0),
  processed_at      timestamptz,
  last_error        text,
  unique (chatwoot_event_id)
);

comment on table public.chatwoot_events is
  'Inbox imutável de webhooks do Chatwoot. Escrita exclusiva de service_role.';
comment on column public.chatwoot_events.chatwoot_event_id is
  'Header X-Chatwoot-Delivery, ou chave determinística montada pelo worker quando ausente.';

/* Serve o worker que varre o que ficou para trás. Espelha
   `idx_payment_gateway_events_pending`. */
create index if not exists idx_chatwoot_events_pending
  on public.chatwoot_events (received_at)
  where processing_status in ('pending', 'error');

alter table public.chatwoot_events enable row level security;

drop policy if exists "chatwoot_events_admin_read" on public.chatwoot_events;
create policy "chatwoot_events_admin_read" on public.chatwoot_events
  for select to authenticated
  using ((select public.eh_admin()));

grant select on public.chatwoot_events to authenticated;
revoke insert, update, delete on public.chatwoot_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Registro — devolve o id existente quando a entrega se repete
--
-- O worker usa o retorno para decidir se processa: se a linha já estava
-- `processed`, não há o que fazer. Por isso devolvemos o status junto do id,
-- em vez de só o id como faz `registrar_evento_gateway` — economiza uma ida ao
-- banco no caminho quente do webhook.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_evento_chatwoot(
  p_chatwoot_event_id text,
  p_event_type        text,
  p_payload           jsonb,
  p_occurred_at       timestamptz default null
)
returns table (event_id uuid, status text, novo boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_status text;
begin
  if nullif(btrim(p_chatwoot_event_id), '') is null then
    raise exception 'Evento do Chatwoot sem identificador de entrega.';
  end if;
  if nullif(btrim(p_event_type), '') is null then
    raise exception 'Evento do Chatwoot sem tipo.';
  end if;

  insert into public.chatwoot_events (chatwoot_event_id, event_type, payload, occurred_at)
  values (
    btrim(p_chatwoot_event_id), btrim(p_event_type),
    coalesce(p_payload, '{}'::jsonb), coalesce(p_occurred_at, now())
  )
  on conflict (chatwoot_event_id) do nothing
  returning id, processing_status into v_id, v_status;

  if v_id is not null then
    return query select v_id, v_status, true;
    return;
  end if;

  select e.id, e.processing_status into v_id, v_status
    from public.chatwoot_events e
   where e.chatwoot_event_id = btrim(p_chatwoot_event_id);

  return query select v_id, v_status, false;
end;
$$;

revoke all on function public.registrar_evento_chatwoot(text, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.registrar_evento_chatwoot(text, text, jsonb, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- Fechamento do evento
--
-- Separado do registro de propósito: entre um e outro roda a interpretação, que
-- pode falhar. `for update` serializa dois workers na mesma linha, e estado
-- terminal não regride — um retry atrasado não pode reabrir o que já foi
-- processado.
-- ---------------------------------------------------------------------------
create or replace function public.concluir_evento_chatwoot(
  p_event_id uuid,
  p_status   text,
  p_error    text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.chatwoot_events%rowtype;
begin
  if p_status not in ('processed', 'ignored', 'error') then
    raise exception 'Status de processamento inválido: %', p_status;
  end if;

  select * into v_event from public.chatwoot_events where id = p_event_id for update;
  if not found then
    raise exception 'Evento não encontrado.';
  end if;

  if v_event.processing_status in ('processed', 'ignored') then
    return v_event.processing_status;
  end if;

  update public.chatwoot_events
     set processing_status = p_status,
         attempts          = attempts + 1,
         processed_at      = case when p_status <> 'error' then now() end,
         last_error        = case when p_status = 'error' then p_error end
   where id = p_event_id;

  return p_status;
end;
$$;

revoke all on function public.concluir_evento_chatwoot(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.concluir_evento_chatwoot(uuid, text, text)
  to service_role;
