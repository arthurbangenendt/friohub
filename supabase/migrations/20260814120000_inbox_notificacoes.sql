-- ---------------------------------------------------------------------------
-- Inbox de notificações dentro do app
--
-- Contexto: `notification_outbox` nasceu como fila de e-mail. `enqueue_notification`
-- filtrava NA ENTRADA — se o usuário desligasse `email_enabled`, o evento nunca
-- chegava a ser gravado. Como consequência, construir o inbox sobre essa tabela
-- faria com que desligar e-mail apagasse também as notificações dentro do
-- produto, que não é o que a pessoa pediu.
--
-- Esta migration inverte isso: a outbox passa a ser o REGISTRO ÚNICO de eventos,
-- e cada canal decide sozinho se entrega. A linha carrega `inapp_allowed` e
-- `email_allowed`, calculados no momento do enfileiramento a partir das
-- preferências. O inbox lê o que tem `inapp_allowed`; o futuro consumidor de
-- e-mail lerá o que tem `email_allowed` e `status = 'pending'`.
--
-- Segurança: `notification_outbox` continua sem política de INSERT/UPDATE/DELETE
-- (contrato verificado em 40_marketplace_operations.test.sql). A leitura pelo
-- destinatário entra como política de SELECT, e marcar como lida — que é um
-- UPDATE — passa por RPC `security definer`, não por política.
--
-- Reversibilidade: tudo é aditivo. As colunas têm default, nenhuma linha
-- existente é reescrita e nenhuma coluna é removida ou renomeada. Voltar atrás
-- significa restaurar a versão anterior de `enqueue_notification`; o inbox
-- simplesmente para de receber linhas novas.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Preferências passam a distinguir canal
--
-- As colunas que já existiam (`email_enabled`, `quote_requests`, …) continuam
-- significando exatamente o que significavam: preferência de E-MAIL. O que
-- entra agora é o espelho delas para o app. Nenhuma coluna muda de sentido, o
-- que evita que uma escolha antiga do usuário passe a valer para um canal que
-- ele nunca configurou.
-- ---------------------------------------------------------------------------
alter table public.notification_preferences
  add column if not exists inapp_enabled        boolean not null default true,
  add column if not exists inapp_quote_requests boolean not null default true,
  add column if not exists inapp_quotes         boolean not null default true,
  add column if not exists inapp_job_updates    boolean not null default true,
  add column if not exists inapp_messages       boolean not null default true,
  add column if not exists inapp_reminders      boolean not null default true;

comment on column public.notification_preferences.email_enabled is
  'Interruptor geral do canal e-mail. Não afeta o inbox dentro do app.';
comment on column public.notification_preferences.inapp_enabled is
  'Interruptor geral do inbox dentro do app.';

-- ---------------------------------------------------------------------------
-- 2. Outbox ganha estado de leitura e permissão por canal
-- ---------------------------------------------------------------------------
alter table public.notification_outbox
  add column if not exists read_at       timestamptz,
  add column if not exists inapp_allowed boolean not null default true,
  add column if not exists email_allowed boolean not null default true;

comment on column public.notification_outbox.read_at is
  'Quando o destinatário leu no app. Independe de `status`, que é do canal e-mail.';
comment on column public.notification_outbox.inapp_allowed is
  'Preferência de inbox no instante do enfileiramento. Congelada de propósito: mudar a preferência não reescreve o passado.';
comment on column public.notification_outbox.email_allowed is
  'Idem para e-mail. O consumidor de e-mail, quando existir, deve filtrar por esta coluna.';

/* O inbox sempre lista por destinatário e do mais recente para o mais antigo.
   O índice existente (`idx_notification_outbox_pending`) serve a fila de envio,
   não a esta consulta. */
create index if not exists idx_notification_outbox_inbox
  on public.notification_outbox (recipient_id, created_at desc)
  where inapp_allowed;

/* Contador de não lidas roda no shell, a cada navegação do painel. Índice
   parcial mantém a varredura restrita ao que de fato está pendente de leitura. */
create index if not exists idx_notification_outbox_nao_lidas
  on public.notification_outbox (recipient_id)
  where inapp_allowed and read_at is null;

-- ---------------------------------------------------------------------------
-- 3. Categoria do evento em um lugar só
--
-- O mapa evento → categoria estava duplicado dentro de `enqueue_notification` e
-- já tinha sido reescrito duas vezes em migrations diferentes. Extrair evita que
-- a terceira reescrita esqueça um dos ramos.
--
-- Existe um espelho em TypeScript, `categoriaNotificacao` em
-- src/lib/notificacoes.ts, usado só para agrupar os contadores dos badges no
-- shell do painel. Esta função aqui é a fonte de verdade; ao mexer no mapa,
-- mexa nos dois.
-- ---------------------------------------------------------------------------
create or replace function public.categoria_notificacao(p_event_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_event_type = 'quote_request_received' then 'quote_requests'
    when p_event_type in ('quote_received', 'quote_accepted', 'quote_cancelled', 'quote_declined') then 'quotes'
    when p_event_type = 'new_message' then 'messages'
    when p_event_type in (
      'appointment_proposed', 'appointment_confirmed',
      'appointment_cancelled', 'appointment_reminder', 'pmoc_visit_due'
    ) then 'reminders'
    else 'job_updates'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Enfileiramento passa a gravar sempre, marcando o canal permitido
--
-- MUDANÇA DE COMPORTAMENTO: antes a função retornava NULL e não gravava nada
-- quando a preferência de e-mail estava desligada. Agora ela grava e marca
-- `email_allowed = false`. É seguro hoje porque não existe nenhum consumidor de
-- e-mail no projeto — nada lê essa fila para enviar. Quando o consumidor for
-- escrito, ele DEVE filtrar por `email_allowed`, senão passa a enviar para quem
-- optou por não receber.
--
-- Quando os dois canais estão desligados nada é gravado: não há para quem
-- entregar, e guardar a linha só encheria a tabela.
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
  v_id uuid;
begin
  if p_recipient_id is null then return null; end if;

  /* Sem linha de preferências, ambos os canais ficam ligados — é o padrão de
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
    end
    into v_email, v_inapp
    from public.notification_preferences np
   where np.user_id = p_recipient_id;

  v_email := coalesce(v_email, true);
  v_inapp := coalesce(v_inapp, true);

  if not v_email and not v_inapp then return null; end if;

  insert into public.notification_outbox (
    recipient_id, event_type, aggregate_type, aggregate_id,
    payload, dedupe_key, available_at, inapp_allowed, email_allowed
  ) values (
    p_recipient_id, p_event_type, p_aggregate_type, p_aggregate_id,
    coalesce(p_payload, '{}'::jsonb), p_dedupe_key, coalesce(p_available_at, now()),
    v_inapp, v_email
  )
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.enqueue_notification(uuid, text, text, uuid, jsonb, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.categoria_notificacao(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. O destinatário passa a ler as próprias notificações
--
-- Só SELECT. O contrato de "nenhuma escrita direta pela Data API" nesta tabela
-- continua valendo — marcar como lida é RPC.
-- ---------------------------------------------------------------------------
create policy "notification_outbox_destinatario_read"
  on public.notification_outbox for select to authenticated
  using ((select auth.uid()) = recipient_id and inapp_allowed);

-- ---------------------------------------------------------------------------
-- 6. Marcar como lida
-- ---------------------------------------------------------------------------

/* Idempotente: reler uma notificação já lida não move `read_at`, para o
   histórico continuar dizendo quando ela foi vista pela primeira vez. */
create or replace function public.marcar_notificacao_lida(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ok boolean;
begin
  if v_uid is null then return false; end if;

  update public.notification_outbox
     set read_at = now()
   where id = p_id
     and recipient_id = v_uid
     and inapp_allowed
     and read_at is null;

  get diagnostics v_ok = row_count;
  return coalesce(v_ok, false);
end;
$$;

create or replace function public.marcar_notificacoes_lidas()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_n integer;
begin
  if v_uid is null then return 0; end if;

  update public.notification_outbox
     set read_at = now()
   where recipient_id = v_uid
     and inapp_allowed
     and read_at is null;

  get diagnostics v_n = row_count;
  return coalesce(v_n, 0);
end;
$$;

revoke all on function public.marcar_notificacao_lida(uuid) from public, anon;
revoke all on function public.marcar_notificacoes_lidas() from public, anon;
grant execute on function public.marcar_notificacao_lida(uuid) to authenticated;
grant execute on function public.marcar_notificacoes_lidas() to authenticated;
