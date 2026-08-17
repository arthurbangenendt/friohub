-- ============================================================================
-- Chatwoot — mapa de identidades
--
-- O Chatwoot passa a ser o motor de conversas (WhatsApp, e-mail, site,
-- Instagram), mas o frontend continua sendo nosso: é aqui que moram as regras
-- que o painel dele não sabe respeitar — o duplo consentimento do telefone
-- (`revelar_contato`), o handoff (`handoff_liberado`) e a auditoria de admin
-- por RLS. Para os dois lados conversarem é preciso um mapa estável entre
-- `profiles.id` e os ids que o Chatwoot gera.
--
-- Três papéis distintos do outro lado, e a tabela guarda os três:
--
--   · `chatwoot_contact_id` — todo mundo é Contact. É por ele que a conversa
--     existe e que o histórico omnichannel se junta.
--
--   · `chatwoot_user_id` — só profissional e equipe. O profissional vira um
--     User do Chatwoot que NUNCA entra no Chatwoot: ele existe apenas para ser
--     `assignee`, o que destrava atribuição, automação de roteamento e
--     relatório por agente. Três proteções independentes garantem isso:
--       1. atribuir não exige ser membro da inbox
--          (Conversations::AssignmentService#assignee busca em account.users);
--       2. criado pela Platform API com `skip_confirmation!` e senha aleatória,
--          e `User` tem `devise :confirmable` — sem confirmar, não loga;
--       3. membro de zero inboxes — `User#assigned_inboxes` devolve vazio para
--          não-admin, e o ConversationFinder recorta a lista por `inbox_id`.
--     Se qualquer uma dessas premissas mudar numa atualização do Chatwoot, o
--     isolamento entre técnicos depende só das outras duas. Vale reconferir ao
--     subir de versão.
--
--   · `pii_synced_at` — quando telefone e e-mail foram enviados ao Chatwoot.
--     O CONTATO NASCE SEM OS DOIS. O painel de contato do Chatwoot mostra tudo
--     que existe na ficha para qualquer agente da inbox, e a equipe FrioHub usa
--     o painel de verdade; sincronizar o telefone na criação anularia na
--     prática o que /privacidade seção 4.1 promete. O preenchimento só acontece
--     depois que `handoff_liberado()` for verdadeiro E os dois consentimentos
--     existirem — a mesma porta de `revelar_contato()`, agora aplicada também
--     na camada de sincronização.
--
-- Reversibilidade: tabela nova, nada existente é tocado. Voltar atrás é
-- `drop table` — o app volta a funcionar com o chat interno como antes.
-- ============================================================================

create table if not exists public.chatwoot_identities (
  profile_id          uuid primary key references public.profiles (id) on delete cascade,
  chatwoot_contact_id bigint unique,
  chatwoot_user_id    bigint unique,
  contact_synced_at   timestamptz,
  pii_synced_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.chatwoot_identities is
  'Mapa entre profiles e os ids do Chatwoot. Escrita exclusiva de service_role.';
comment on column public.chatwoot_identities.chatwoot_user_id is
  'Só profissional e equipe. Usuário criado sem confirmação e sem inbox: serve para ser assignee, não para logar.';
comment on column public.chatwoot_identities.pii_synced_at is
  'Quando telefone/e-mail foram enviados ao Chatwoot. Nulo até o handoff liberar e os DOIS consentirem.';

create trigger trg_chatwoot_identities_touch
  before update on public.chatwoot_identities
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: leitura do dono e do admin; escrita não existe pela Data API
--
-- Mesmo contrato de `payment_gateway_events`: quem escreve é função definer
-- restrita a service_role. Deixar o próprio usuário editar o vínculo permitiria
-- apontar o próprio profile para o contato de outra pessoa.
-- ---------------------------------------------------------------------------
alter table public.chatwoot_identities enable row level security;

drop policy if exists "chatwoot_identities_self_read" on public.chatwoot_identities;
create policy "chatwoot_identities_self_read" on public.chatwoot_identities
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.eh_admin()));

grant select on public.chatwoot_identities to authenticated;
revoke insert, update, delete on public.chatwoot_identities from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Registro do vínculo — idempotente por profile
--
-- Recebe só o que o provisionamento acabou de descobrir; os parâmetros nulos
-- não apagam o que já existe. Isso permite chamar duas vezes (contato primeiro,
-- usuário depois) sem perder o primeiro vínculo.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_identidade_chatwoot(
  p_profile_id uuid,
  p_contact_id bigint default null,
  p_user_id    bigint default null
)
returns public.chatwoot_identities
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.chatwoot_identities%rowtype;
begin
  if p_profile_id is null then
    raise exception 'Identidade Chatwoot exige um profile.';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'Profile inexistente.';
  end if;

  insert into public.chatwoot_identities (profile_id, chatwoot_contact_id, chatwoot_user_id, contact_synced_at)
  values (
    p_profile_id, p_contact_id, p_user_id,
    case when p_contact_id is not null then now() end
  )
  on conflict (profile_id) do update
     set chatwoot_contact_id = coalesce(excluded.chatwoot_contact_id, public.chatwoot_identities.chatwoot_contact_id),
         chatwoot_user_id    = coalesce(excluded.chatwoot_user_id,    public.chatwoot_identities.chatwoot_user_id),
         contact_synced_at   = coalesce(excluded.contact_synced_at,   public.chatwoot_identities.contact_synced_at)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.registrar_identidade_chatwoot(uuid, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.registrar_identidade_chatwoot(uuid, bigint, bigint)
  to service_role;

-- ---------------------------------------------------------------------------
-- A porta do PII — a mesma de `revelar_contato`, do lado da sincronização
--
-- Devolve o telefone e o e-mail do participante SOMENTE se aquela conversa já
-- passou pelas duas condições. Quem chama é o worker de sincronização, com
-- service_role; nenhuma sessão de usuário alcança esta função.
--
-- Repare que a checagem é por CONVERSA, não por pessoa: o consentimento vale
-- para o par que conversou, não é um interruptor global do perfil.
-- ---------------------------------------------------------------------------
create or replace function public.pii_liberado_para_chatwoot(p_conversation_id uuid)
returns table (profile_id uuid, telefone text, email text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_conv public.conversations%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if not found then
    raise exception 'Conversa não encontrada.';
  end if;

  if not public.handoff_liberado(p_conversation_id) then
    return;
  end if;

  if (
    select count(*) from public.conversation_contact_consent cc
     where cc.conversation_id = p_conversation_id
       and cc.user_id in (v_conv.cliente_id, v_conv.professional_id)
  ) < 2 then
    return;
  end if;

  return query
    select p.id, pp.telefone, u.email::text
      from public.profiles p
      left join public.profile_private pp on pp.id = p.id
      left join auth.users u on u.id = p.id
     where p.id in (v_conv.cliente_id, v_conv.professional_id);
end;
$$;

comment on function public.pii_liberado_para_chatwoot is
  'Telefone/e-mail dos dois participantes, e só depois de handoff liberado + duplo consentimento. Espelha revelar_contato() para o worker de sincronização.';

revoke all on function public.pii_liberado_para_chatwoot(uuid) from public, anon, authenticated;
grant execute on function public.pii_liberado_para_chatwoot(uuid) to service_role;

-- Marca que o PII já subiu, para o worker não reenviar a cada evento.
create or replace function public.marcar_pii_sincronizado_chatwoot(p_profile_ids uuid[])
returns integer
language sql
security definer
set search_path = public
as $$
  with atualizadas as (
    update public.chatwoot_identities
       set pii_synced_at = now()
     where profile_id = any(p_profile_ids)
       and pii_synced_at is null
    returning 1
  )
  select count(*)::integer from atualizadas;
$$;

revoke all on function public.marcar_pii_sincronizado_chatwoot(uuid[]) from public, anon, authenticated;
grant execute on function public.marcar_pii_sincronizado_chatwoot(uuid[]) to service_role;
