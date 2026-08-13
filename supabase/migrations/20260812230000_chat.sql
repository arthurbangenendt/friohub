-- ============================================================================
-- CHAT INTERNO — o canal que faltava entre cliente e profissional
--
-- Até aqui, depois que o cliente escolhia um profissional, nenhum dos dois tinha
-- como falar com o outro: o telefone vive em `profile_private`, legível apenas
-- pelo dono (20260812120000). O job nascia, era aceito, e ninguém conseguia
-- combinar nada. A tela de perfil do cliente ainda prometia que "só o
-- profissional do seu serviço vê seu telefone" — coisa que nunca foi verdade.
--
-- Decisão do time: a conversa acontece DENTRO da plataforma. O telefone continua
-- privado e só é revelado quando:
--
--   · a conversa já é frequente (4 dias distintos com troca dos DOIS lados),
--     ou já existe um serviço fechado entre eles;  e
--   · as DUAS partes autorizarem explicitamente.
--
-- `profile_private` NÃO é afrouxado. A revelação passa por `revelar_contato()`,
-- que é SECURITY DEFINER e checa as duas condições antes de devolver o número.
-- Esse desenho é o que mantém verdadeiro o texto da política de privacidade.
--
-- Também por decisão do time: não há detecção de telefone/e-mail digitado no
-- corpo da mensagem. Bloquear é trivial de burlar ("nove nove sete...") e gera
-- atrito; o incentivo real de manter a conversa aqui é o histórico e a proteção
-- do serviço.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Conversas
--
--    `job_id` é anulável de propósito: o cliente pode mandar mensagem ANTES de
--    fechar, direto do card do profissional — é assim que ele tira dúvida antes
--    de contratar. A conversa é única por par (cliente, profissional); o job é
--    só o vínculo mais recente, não a chave.
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references public.profiles (id) on delete cascade,
  professional_id uuid not null references public.professionals (id) on delete cascade,
  job_id          uuid references public.jobs (id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz,
  unique (cliente_id, professional_id)
);

comment on table public.conversations is
  'Uma conversa por par cliente↔profissional. Pode existir antes de qualquer job.';

-- Ordena a lista de conversas sem varrer `messages`.
create index if not exists idx_conversations_cliente on public.conversations (cliente_id, last_message_at desc);
create index if not exists idx_conversations_pro     on public.conversations (professional_id, last_message_at desc);

-- ---------------------------------------------------------------------------
-- 2. Mensagens
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  body            text not null check (length(btrim(body)) between 1 and 4000),
  created_at      timestamptz not null default now(),
  read_at         timestamptz
);

create index if not exists idx_messages_conversa on public.messages (conversation_id, created_at);
-- Serve a contagem de não lidas no menu, que roda em toda navegação do painel.
create index if not exists idx_messages_nao_lidas on public.messages (conversation_id, sender_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- 3. Consentimento para troca de contato
--
--    Uma linha por pessoa que autorizou. Duas linhas = contato liberado.
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_contact_consent (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  consented_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 4. `last_message_at` por trigger
-- ---------------------------------------------------------------------------
create or replace function public.touch_conversa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_messages_touch_conversa on public.messages;
create trigger trg_messages_touch_conversa
  after insert on public.messages
  for each row execute function public.touch_conversa();

-- ---------------------------------------------------------------------------
-- 5. RLS
--
--    Admin lê conversas e mensagens (decisão do time) para arbitrar disputa —
--    "ele disse que faria X" só é resolvível com o registro à vista. Está
--    declarado em /privacidade. Admin NÃO escreve: não se finge participante.
-- ---------------------------------------------------------------------------
alter table public.conversations                 enable row level security;
alter table public.messages                      enable row level security;
alter table public.conversation_contact_consent  enable row level security;

create or replace function public.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;
comment on function public.eh_admin is
  'Checagem de admin para uso em policies. SECURITY DEFINER evita recursão de RLS ao ler profiles de dentro de outra policy.';

drop policy if exists "conversas_participante_read" on public.conversations;
create policy "conversas_participante_read" on public.conversations for select
  using (auth.uid() in (cliente_id, professional_id) or public.eh_admin());

/* Quem abre: o cliente, a partir do perfil ou do wizard. O profissional só abre
   se já existir um serviço entre os dois — assim ninguém vira canal de aborda-
   gem não solicitada a clientes que nunca o procuraram. */
drop policy if exists "conversas_insert" on public.conversations;
create policy "conversas_insert" on public.conversations for insert
  with check (
    (cliente_id = auth.uid())
    or (
      professional_id = auth.uid()
      and exists (
        select 1 from public.jobs j
         where j.profissional_id = auth.uid()
           and j.cliente_id = conversations.cliente_id
      )
    )
  );

drop policy if exists "conversas_participante_update" on public.conversations;
create policy "conversas_participante_update" on public.conversations for update
  using (auth.uid() in (cliente_id, professional_id))
  with check (auth.uid() in (cliente_id, professional_id));

drop policy if exists "mensagens_participante_read" on public.messages;
create policy "mensagens_participante_read" on public.messages for select
  using (
    exists (
      select 1 from public.conversations c
       where c.id = messages.conversation_id
         and (auth.uid() in (c.cliente_id, c.professional_id) or public.eh_admin())
    )
  );

/* Só participante escreve, e só em nome de si mesmo. Não há policy de UPDATE nem
   de DELETE: mensagem enviada não se edita nem se apaga — é o registro que
   sustenta a arbitragem. Marcar como lida passa por função definer (item 7). */
drop policy if exists "mensagens_participante_insert" on public.messages;
create policy "mensagens_participante_insert" on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
       where c.id = messages.conversation_id
         and auth.uid() in (c.cliente_id, c.professional_id)
    )
  );

drop policy if exists "consent_participante_read" on public.conversation_contact_consent;
create policy "consent_participante_read" on public.conversation_contact_consent for select
  using (
    exists (
      select 1 from public.conversations c
       where c.id = conversation_contact_consent.conversation_id
         and auth.uid() in (c.cliente_id, c.professional_id)
    )
  );

drop policy if exists "consent_proprio_insert" on public.conversation_contact_consent;
create policy "consent_proprio_insert" on public.conversation_contact_consent for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.conversations c
       where c.id = conversation_contact_consent.conversation_id
         and auth.uid() in (c.cliente_id, c.professional_id)
    )
  );

-- Desautorizar é direito de quem autorizou.
drop policy if exists "consent_proprio_delete" on public.conversation_contact_consent;
create policy "consent_proprio_delete" on public.conversation_contact_consent for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 6. Regra do handoff para o WhatsApp
--
--    "Conversa frequente por 4 dias" = 4 datas DISTINTAS em que os dois lados
--    falaram. Contar mensagens seria fácil de inflar mandando 20 num minuto;
--    contar dias com troca mútua descreve o que a regra quer dizer.
--
--    Serviço fechado libera na hora: quem já contratou precisa se falar hoje,
--    não daqui a quatro dias.
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
    having count(distinct m.sender_id) >= 2
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
  'Libera a SUGESTÃO de trocar contato: 4 dias distintos com troca dos dois lados, ou serviço já fechado.';

-- ---------------------------------------------------------------------------
-- 7. Revelação do contato — o único caminho até o telefone
--
--    SECURITY DEFINER porque `profile_private` é restrita ao dono e deve
--    continuar assim. Toda a autorização está explícita aqui dentro: participante,
--    handoff liberado, e consentimento dos DOIS.
-- ---------------------------------------------------------------------------
create or replace function public.revelar_contato(p_conversation_id uuid)
returns table (nome text, telefone text, whatsapp_url text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv   public.conversations%rowtype;
  v_outro  uuid;
  v_tel    text;
  v_nome   text;
  v_digitos text;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if not found then
    raise exception 'Conversa não encontrada.';
  end if;

  if auth.uid() = v_conv.cliente_id then
    v_outro := v_conv.professional_id;
  elsif auth.uid() = v_conv.professional_id then
    v_outro := v_conv.cliente_id;
  else
    raise exception 'Você não participa desta conversa.';
  end if;

  if not public.handoff_liberado(p_conversation_id) then
    raise exception 'A troca de contato ainda não foi liberada nesta conversa.';
  end if;

  if (
    select count(*) from public.conversation_contact_consent cc
     where cc.conversation_id = p_conversation_id
       and cc.user_id in (v_conv.cliente_id, v_conv.professional_id)
  ) < 2 then
    raise exception 'Aguardando a outra pessoa autorizar a troca de contato.';
  end if;

  select pp.telefone into v_tel  from public.profile_private pp where pp.id = v_outro;
  select p.nome      into v_nome from public.profiles p        where p.id = v_outro;

  v_digitos := regexp_replace(coalesce(v_tel, ''), '\D', '', 'g');

  return query select
    v_nome,
    v_tel,
    case when length(v_digitos) in (10, 11) then 'https://wa.me/55' || v_digitos end;
end;
$$;

revoke all on function public.revelar_contato(uuid) from public;
grant execute on function public.revelar_contato(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Abrir conversa e marcar como lida
-- ---------------------------------------------------------------------------

/* Cria a conversa do cliente com um profissional, ou devolve a existente.
   Invoker de propósito: a RLS de `conversations` é quem autoriza. */
create or replace function public.abrir_conversa(p_professional_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  select id into v_id
    from public.conversations
   where cliente_id = auth.uid() and professional_id = p_professional_id;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.conversations (cliente_id, professional_id)
  values (auth.uid(), p_professional_id)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.abrir_conversa(uuid) to authenticated;

/* Marcar como lida é a única escrita permitida sobre uma mensagem já enviada, e
   por isso vive numa função em vez de uma policy de UPDATE — policy é por linha
   e deixaria o participante reescrever o corpo da mensagem também. */
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

  update public.messages
     set read_at = now()
   where conversation_id = p_conversation_id
     and sender_id <> auth.uid()
     and read_at is null;
end;
$$;

grant execute on function public.marcar_conversa_lida(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Realtime — a thread precisa atualizar sem recarregar a página
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
