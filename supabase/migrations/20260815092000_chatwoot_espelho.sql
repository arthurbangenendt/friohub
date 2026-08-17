-- ============================================================================
-- Chatwoot — espelho das conversas no Postgres
--
-- O Chatwoot passa a ser a fonte de verdade da conversa, mas `messages`
-- continua existindo como ESPELHO DE LEITURA. Não é redundância: é o que
-- mantém funcionando, sem reescrita, quatro coisas que já têm teste —
--
--   1. `handoff_liberado()`, que conta dias de troca em cima de `messages`;
--   2. o Supabase Realtime que a thread consome (só `messages` está na
--      publication — ver 20260812230000 item 9);
--   3. o contador de não lidas do menu do painel;
--   4. a leitura de admin por RLS, que é o que /termos 6.1 promete.
--
-- Ler direto da API do Chatwoot a cada render trocaria RLS por checagem em
-- código de aplicação e mataria os quatro. O espelho custa um webhook.
--
-- ---------------------------------------------------------------------------
-- A MUDANÇA DELICADA: `messages.sender_id` deixa de ser NOT NULL
-- ---------------------------------------------------------------------------
-- Passam a existir mensagens sem autor em `profiles`: resposta da equipe
-- FrioHub pelo painel do Chatwoot, mensagem de automação, aviso de sistema.
-- Como não há `profiles` para elas, `sender_id` fica nulo e quem passa a dizer
-- de onde veio é `sender_kind`.
--
-- Três lugares dependiam de `sender_id` e são corrigidos aqui:
--
--   · `handoff_liberado()` contava `count(distinct sender_id) >= 2` por dia.
--     Sem correção, uma resposta da equipe FrioHub contaria como "os dois lados
--     falaram" e ANTECIPARIA a liberação do telefone — exatamente a regra que
--     /privacidade 4.1 promete. Agora só `cliente` e `profissional` contam.
--
--   · `marcar_conversa_lida()` usava `sender_id <> auth.uid()`. Com nulo isso
--     é NULL, não `true`, então mensagem de automação nunca seria marcada como
--     lida e o badge do menu ficaria preso para sempre. Passa a `is distinct
--     from`.
--
--   · `notifica_nova_mensagem()` decidia o destinatário comparando `sender_id`
--     com `cliente_id`. Com nulo cairia sempre no ramo ELSE. Passa a decidir
--     por `sender_kind`.
--
-- A policy de INSERT de `messages` continua exigindo `sender_id = auth.uid()`,
-- e `NULL = uuid` é NULL — ou seja, nenhuma sessão de usuário consegue inserir
-- mensagem sem autor. Só a RPC definer abaixo, restrita a service_role.
--
-- Reversibilidade: tudo aditivo, exceto o `drop not null`. Voltar atrás exige
-- que não exista nenhuma linha com `sender_id` nulo — na prática, desligar a
-- flag `chatwoot_messaging` e apagar as mensagens espelhadas.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Vocabulário de canal e de autor
-- ---------------------------------------------------------------------------

/* 'outro' existe para o worker ter onde cair quando o Chatwoot ganhar um canal
   que este check ainda não conhece. Um canal novo não pode derrubar o espelho. */
alter table public.conversations
  add column if not exists chatwoot_conversation_id bigint,
  add column if not exists chatwoot_inbox_id        bigint,
  add column if not exists canal                    text not null default 'app'
    check (canal in ('app', 'site', 'whatsapp', 'email', 'instagram', 'facebook', 'telegram', 'sms', 'outro')),
  add column if not exists status_atendimento       text not null default 'open'
    check (status_atendimento in ('open', 'pending', 'resolved'));

create unique index if not exists uq_conversations_chatwoot
  on public.conversations (chatwoot_conversation_id)
  where chatwoot_conversation_id is not null;

comment on column public.conversations.chatwoot_conversation_id is
  'É o display_id do Chatwoot, não o id interno: é ele que vem no webhook (Conversations::EventDataPresenter) e é ele que a API aceita na URL (find_by!(display_id:)).';
comment on column public.conversations.canal is
  'Último canal por onde a conversa se moveu. ''app'' é o chat interno; os demais vêm do Chatwoot.';
comment on column public.conversations.status_atendimento is
  'Espelha o status da conversa no Chatwoot. Não confundir com o status do job.';

alter table public.messages
  add column if not exists chatwoot_message_id bigint,
  add column if not exists canal               text not null default 'app'
    check (canal in ('app', 'site', 'whatsapp', 'email', 'instagram', 'facebook', 'telegram', 'sms', 'outro')),
  add column if not exists sender_kind         text;

create unique index if not exists uq_messages_chatwoot
  on public.messages (chatwoot_message_id)
  where chatwoot_message_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Backfill de `sender_kind` antes de exigir a coluna
--
-- Toda mensagem existente foi escrita por um participante — a policy de INSERT
-- nunca permitiu outra coisa. Então o backfill é exato, não é chute.
-- ---------------------------------------------------------------------------
update public.messages m
   set sender_kind = case
         when m.sender_id = c.professional_id then 'profissional'
         else 'cliente'
       end
  from public.conversations c
 where c.id = m.conversation_id
   and m.sender_kind is null;

/* Preenche o que a Data API insere pelo caminho antigo, que não conhece a
   coluna. Deriva do participante; se o autor não for participante (não deveria
   acontecer — a policy impede), erra para 'cliente', que é o ramo conservador:
   'cliente' é o único valor que NÃO adianta o handoff sozinho. */
create or replace function public.deriva_sender_kind()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv public.conversations%rowtype;
begin
  if new.sender_kind is not null then
    return new;
  end if;

  if new.sender_id is null then
    raise exception 'Mensagem sem autor precisa declarar sender_kind.';
  end if;

  select * into v_conv from public.conversations where id = new.conversation_id;
  new.sender_kind := case when new.sender_id = v_conv.professional_id then 'profissional' else 'cliente' end;
  return new;
end;
$$;

revoke all on function public.deriva_sender_kind() from public, anon, authenticated;

drop trigger if exists trg_messages_sender_kind on public.messages;
create trigger trg_messages_sender_kind
  before insert on public.messages
  for each row execute function public.deriva_sender_kind();

alter table public.messages alter column sender_kind set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_sender_kind_check'
  ) then
    alter table public.messages
      add constraint messages_sender_kind_check
      check (sender_kind in ('cliente', 'profissional', 'equipe', 'automacao', 'sistema'));
  end if;
end $$;

alter table public.messages alter column sender_id drop not null;

comment on column public.messages.sender_kind is
  'De onde veio a mensagem. É ele, e não sender_id, que decide handoff e destinatário de notificação.';
comment on column public.messages.sender_id is
  'Nulo quando o autor não tem profile (equipe FrioHub pelo painel do Chatwoot, automação, sistema).';

-- ---------------------------------------------------------------------------
-- 3. Handoff: só participante conta como "os dois lados falaram"
--
-- Regra de negócio inalterada — 4 dias distintos com troca mútua, ou serviço
-- fechado. O que muda é que resposta da equipe FrioHub e mensagem automática
-- deixam de ser contadas como participação, porque não são.
-- ---------------------------------------------------------------------------
create or replace function public.handoff_liberado(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select * from public.conversations where id = p_conversation_id
  ),
  dias_com_troca as (
    select m.created_at::date as dia
      from public.messages m
      join c on c.id = m.conversation_id
     group by m.created_at::date
    having count(distinct m.sender_kind)
             filter (where m.sender_kind in ('cliente', 'profissional')) >= 2
  )
  select
    (select count(*) from dias_com_troca) >= 4
    or exists (
      select 1
        from public.jobs j
        join c on j.cliente_id = c.cliente_id and j.profissional_id = c.professional_id
       where j.status in ('aceito', 'em_execucao', 'concluido', 'avaliado')
    );
$$;

comment on function public.handoff_liberado is
  'Libera a SUGESTÃO de trocar contato: 4 dias distintos com troca dos dois lados, ou serviço já fechado. Equipe e automação não contam como lado.';

-- ---------------------------------------------------------------------------
-- 4. Leitura: mensagem sem autor também precisa poder ser marcada como lida
-- ---------------------------------------------------------------------------
create or replace function public.marcar_conversa_lida(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.conversations c
     where c.id = p_conversation_id
       and auth.uid() in (c.cliente_id, c.professional_id)
  ) then
    raise exception 'Você não participa desta conversa.';
  end if;

  /* `is distinct from` e não `<>`: com sender_id nulo (equipe, automação) a
     comparação simples devolve NULL e a linha nunca seria marcada, deixando o
     badge de não lidas preso. */
  update public.messages
     set read_at = now()
   where conversation_id = p_conversation_id
     and sender_id is distinct from auth.uid()
     and read_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Destinatário da notificação passa a sair de `sender_kind`
--
-- No modelo do Chatwoot o Contact é sempre o cliente e tudo do lado do agente
-- fala com ele. Então: mensagem do cliente avisa o profissional; mensagem do
-- profissional, da equipe ou de automação avisa o cliente. 'sistema' não avisa
-- ninguém — é ruído de estado (conversa resolvida, reaberta), não conteúdo.
-- ---------------------------------------------------------------------------
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
  if new.sender_kind = 'sistema' then
    return new;
  end if;

  select * into v_conv from public.conversations where id = new.conversation_id;

  v_recipient := case
    when new.sender_kind = 'cliente' then v_conv.professional_id
    else v_conv.cliente_id
  end;

  v_bucket := floor(extract(epoch from new.created_at) / 300);

  perform public.enqueue_notification(
    v_recipient, 'new_message', 'conversation', new.conversation_id,
    jsonb_build_object('sender_id', new.sender_id, 'sender_kind', new.sender_kind, 'canal', new.canal),
    format('new-message:%s:%s:%s', new.conversation_id, v_recipient, v_bucket)
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Vínculo da conversa com o Chatwoot
-- ---------------------------------------------------------------------------
create or replace function public.vincular_conversa_chatwoot(
  p_conversation_id          uuid,
  p_chatwoot_conversation_id bigint,
  p_chatwoot_inbox_id        bigint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
     set chatwoot_conversation_id = p_chatwoot_conversation_id,
         chatwoot_inbox_id        = coalesce(p_chatwoot_inbox_id, chatwoot_inbox_id)
   where id = p_conversation_id;

  if not found then
    raise exception 'Conversa não encontrada.';
  end if;
end;
$$;

revoke all on function public.vincular_conversa_chatwoot(uuid, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.vincular_conversa_chatwoot(uuid, bigint, bigint)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. O espelho propriamente dito
--
-- Idempotente pelo unique de `chatwoot_message_id`: reentrega do webhook não
-- duplica mensagem. Devolve o id da mensagem local — o mesmo, tenha ela sido
-- criada agora ou já existisse.
--
-- Duas defesas contra o Chatwoot derrubar a fila com conteúdo que `messages`
-- não aceita (o check exige body entre 1 e 4000 caracteres):
--   · mensagem só de anexo chega com body vazio → vira '[anexo]';
--   · e-mail longo estoura 4000 → é truncado com reticências.
-- Sem isso, uma única mensagem fora do formato deixaria o evento em 'error'
-- para sempre e travaria o espelho daquela conversa.
-- ---------------------------------------------------------------------------
create or replace function public.espelhar_mensagem_chatwoot(
  p_chatwoot_conversation_id bigint,
  p_chatwoot_message_id      bigint,
  p_body                     text,
  p_sender_kind              text,
  p_sender_profile_id        uuid        default null,
  p_canal                    text        default 'app',
  p_created_at               timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_body            text;
  v_id              uuid;
begin
  if p_sender_kind not in ('cliente', 'profissional', 'equipe', 'automacao', 'sistema') then
    raise exception 'sender_kind inválido: %', p_sender_kind;
  end if;

  /* Sem o id da mensagem no Chatwoot não há chave de idempotência, e o
     `on conflict` abaixo passaria batido — reentrega viraria duplicata. */
  if p_chatwoot_message_id is null then
    raise exception 'Espelho exige o id da mensagem no Chatwoot.';
  end if;

  select id into v_conversation_id
    from public.conversations
   where chatwoot_conversation_id = p_chatwoot_conversation_id;

  if v_conversation_id is null then
    raise exception 'Conversa do Chatwoot % não está vinculada.', p_chatwoot_conversation_id;
  end if;

  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' then
    v_body := '[anexo]';
  elsif length(v_body) > 4000 then
    v_body := left(v_body, 3997) || '...';
  end if;

  insert into public.messages (
    conversation_id, sender_id, sender_kind, body, canal, chatwoot_message_id, created_at
  ) values (
    v_conversation_id, p_sender_profile_id, p_sender_kind, v_body,
    coalesce(p_canal, 'app'), p_chatwoot_message_id, coalesce(p_created_at, now())
  )
  on conflict (chatwoot_message_id) where chatwoot_message_id is not null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.messages
     where chatwoot_message_id = p_chatwoot_message_id;
  end if;

  update public.conversations
     set canal = coalesce(p_canal, canal)
   where id = v_conversation_id;

  return v_id;
end;
$$;

revoke all on function public.espelhar_mensagem_chatwoot(
  bigint, bigint, text, text, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.espelhar_mensagem_chatwoot(
  bigint, bigint, text, text, uuid, text, timestamptz
) to service_role;

-- Status de atendimento vindo do Chatwoot (resolvida, pendente, reaberta).
create or replace function public.atualizar_status_conversa_chatwoot(
  p_chatwoot_conversation_id bigint,
  p_status                   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('open', 'pending', 'resolved') then
    raise exception 'Status de atendimento inválido: %', p_status;
  end if;

  update public.conversations
     set status_atendimento = p_status
   where chatwoot_conversation_id = p_chatwoot_conversation_id;
end;
$$;

revoke all on function public.atualizar_status_conversa_chatwoot(bigint, text)
  from public, anon, authenticated;
grant execute on function public.atualizar_status_conversa_chatwoot(bigint, text)
  to service_role;
