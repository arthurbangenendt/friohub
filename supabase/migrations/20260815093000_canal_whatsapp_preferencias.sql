-- ============================================================================
-- Terceiro canal na outbox: WhatsApp (entregue pelo Chatwoot)
--
-- Repete, sem inventar nada, o desenho que 20260814120000 usou para separar
-- inbox de e-mail: a outbox continua sendo o REGISTRO ÚNICO de eventos, e cada
-- canal carrega sua própria permissão, congelada no enfileiramento. O consumidor
-- de WhatsApp DEVE filtrar por `whatsapp_allowed` — ignorar a coluna significa
-- mandar mensagem para quem pediu para não receber.
--
-- ---------------------------------------------------------------------------
-- Por que o padrão é LIGADO, e onde isso para de valer
-- ---------------------------------------------------------------------------
-- Mesma escolha que o e-mail já fazia: quem nunca abriu a tela de preferências
-- recebe. Isso se sustenta porque tudo que passa por esta fila é TRANSACIONAL —
-- são os 14 event_types de `categoria_notificacao`, todos sobre um pedido, um
-- serviço ou um agendamento que a própria pessoa iniciou.
--
-- O que NÃO pode passar por aqui: divulgação, promoção, reengajamento. Para
-- isso o padrão teria que ser desligado e o consentimento, explícito. Se um dia
-- entrar um evento de marketing na outbox, esta coluna deixa de ser suficiente
-- e o canal precisa de opt-in próprio.
--
-- Reversibilidade: aditivo. Colunas com default, nenhuma linha reescrita.
-- Voltar atrás é restaurar a versão anterior de `enqueue_notification`.
-- ============================================================================

alter table public.notification_preferences
  add column if not exists whatsapp_enabled        boolean not null default true,
  add column if not exists whatsapp_quote_requests boolean not null default true,
  add column if not exists whatsapp_quotes         boolean not null default true,
  add column if not exists whatsapp_job_updates    boolean not null default true,
  add column if not exists whatsapp_messages       boolean not null default true,
  add column if not exists whatsapp_reminders      boolean not null default true;

comment on column public.notification_preferences.whatsapp_enabled is
  'Interruptor geral do canal WhatsApp. Não afeta o inbox no app nem o e-mail.';

alter table public.notification_outbox
  add column if not exists whatsapp_allowed boolean not null default true;

comment on column public.notification_outbox.whatsapp_allowed is
  'Preferência de WhatsApp no instante do enfileiramento. Congelada: mudar a preferência não reescreve o passado. O consumidor DEVE filtrar por ela.';

/* Índice da fila de saída do WhatsApp. O `idx_notification_outbox_pending`
   existente não tem a coluna nova no recorte, então serviria varrendo linhas
   que este canal nunca vai entregar. */
create index if not exists idx_notification_outbox_whatsapp
  on public.notification_outbox (available_at)
  where whatsapp_allowed and status in ('pending', 'failed');

-- ---------------------------------------------------------------------------
-- Enfileiramento com três canais
--
-- Mesma assinatura de antes — nenhum chamador muda. A única diferença de
-- comportamento é que agora só se descarta o evento quando os TRÊS canais estão
-- desligados.
-- ---------------------------------------------------------------------------
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
  v_categoria text := public.categoria_notificacao(p_event_type);
  v_email boolean := true;
  v_inapp boolean := true;
  v_whats boolean := true;
  v_id uuid;
begin
  if p_recipient_id is null then return null; end if;

  /* Sem linha de preferências, os três canais ficam ligados — é o padrão de
     quem nunca abriu a tela. `coalesce` cobre o caso de a linha existir com
     colunas nulas. */
  select
    np.email_enabled and case v_categoria
      when 'quote_requests' then np.quote_requests
      when 'quotes'         then np.quotes
      when 'messages'       then np.messages
      when 'reminders'      then np.reminders
      else np.job_updates
    end,
    np.inapp_enabled and case v_categoria
      when 'quote_requests' then np.inapp_quote_requests
      when 'quotes'         then np.inapp_quotes
      when 'messages'       then np.inapp_messages
      when 'reminders'      then np.inapp_reminders
      else np.inapp_job_updates
    end,
    np.whatsapp_enabled and case v_categoria
      when 'quote_requests' then np.whatsapp_quote_requests
      when 'quotes'         then np.whatsapp_quotes
      when 'messages'       then np.whatsapp_messages
      when 'reminders'      then np.whatsapp_reminders
      else np.whatsapp_job_updates
    end
    into v_email, v_inapp, v_whats
    from public.notification_preferences np
   where np.user_id = p_recipient_id;

  v_email := coalesce(v_email, true);
  v_inapp := coalesce(v_inapp, true);
  v_whats := coalesce(v_whats, true);

  if not v_email and not v_inapp and not v_whats then return null; end if;

  insert into public.notification_outbox (
    recipient_id, event_type, aggregate_type, aggregate_id,
    payload, dedupe_key, available_at, inapp_allowed, email_allowed, whatsapp_allowed
  ) values (
    p_recipient_id, p_event_type, p_aggregate_type, p_aggregate_id,
    coalesce(p_payload, '{}'::jsonb), p_dedupe_key, coalesce(p_available_at, now()),
    v_inapp, v_email, v_whats
  )
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.enqueue_notification(uuid, text, text, uuid, jsonb, text, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reserva da fila para o worker
--
-- O contrato escrito em src/lib/notificacoes-canal.ts vira função: o recorte
-- correto (`whatsapp_allowed`, `available_at`, `for update skip locked`) fica
-- aqui, e não copiado dentro de uma Edge Function onde ninguém revisa. Marca as
-- linhas como `processing` e devolve o que o worker precisa para montar a
-- mensagem.
--
-- `attempts` é incrementado na reserva, não na conclusão: assim uma execução
-- que morre no meio (timeout da function, deploy) ainda consome tentativa e não
-- fica reservando a mesma linha para sempre.
-- ---------------------------------------------------------------------------
create or replace function public.reservar_notificacoes_whatsapp(p_limite integer default 20)
returns table (
  id            uuid,
  recipient_id  uuid,
  event_type    text,
  aggregate_type text,
  aggregate_id  uuid,
  payload       jsonb,
  attempts      integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidatas as (
    select o.id
      from public.notification_outbox o
     where o.status in ('pending', 'failed')
       and o.whatsapp_allowed
       and o.available_at <= now()
     order by o.created_at
     limit greatest(1, least(coalesce(p_limite, 20), 100))
     for update skip locked
  )
  update public.notification_outbox o
     set status = 'processing',
         locked_at = now(),
         attempts = o.attempts + 1
    from candidatas c
   where o.id = c.id
  returning o.id, o.recipient_id, o.event_type, o.aggregate_type,
            o.aggregate_id, o.payload, o.attempts;
end;
$$;

revoke all on function public.reservar_notificacoes_whatsapp(integer)
  from public, anon, authenticated;
grant execute on function public.reservar_notificacoes_whatsapp(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Conclusão do envio
--
-- `status` pertence ao canal de entrega; `read_at` pertence ao inbox. Um não
-- encosta no outro — entregar no WhatsApp não marca a notificação como lida no
-- app. Falha volta para `failed` com recuo exponencial limitado a 1 hora.
-- ---------------------------------------------------------------------------
create or replace function public.concluir_notificacao_whatsapp(
  p_id uuid,
  p_enviado boolean,
  p_erro text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_enviado then
    update public.notification_outbox
       set status = 'sent', sent_at = now(), locked_at = null, last_error = null
     where id = p_id;
  else
    update public.notification_outbox
       set status = 'failed',
           locked_at = null,
           last_error = left(coalesce(p_erro, 'erro desconhecido'), 500),
           available_at = now() + make_interval(secs => least(3600, power(2, least(attempts, 12))::integer * 30))
     where id = p_id;
  end if;
end;
$$;

revoke all on function public.concluir_notificacao_whatsapp(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.concluir_notificacao_whatsapp(uuid, boolean, text) to service_role;
