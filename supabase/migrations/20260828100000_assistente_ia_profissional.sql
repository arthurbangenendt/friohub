-- ============================================================================
-- Assistente de IA do profissional (V1 — chat técnico + triagem de orçamento)
--
-- Já vendido na vitrine (`subscription_plans.features->>'assistente'`, só
-- Master — 20260813190000): "assistente técnico: dimensionamento de BTU e
-- diagnóstico" + "rascunho de orçamento gerado a partir do pedido do
-- cliente". O gate de acesso é `plano_permite(id, 'assistente')`, já
-- existente — esta migration só cria o schema de conversa/histórico e o
-- rate limit; não mexe em planos.
--
-- Fora de escopo aqui (Fase 2, registrado em plano à parte): auto-envio de
-- proposta, disponibilidade configurável do profissional, hold de agenda.
-- Esta migration não cria nada dessas três peças — não reusar o prefixo
-- `assistant_` para algo que não seja histórico de conversa sem reler o
-- plano da Fase 2 primeiro.
-- ============================================================================

create table public.assistant_conversations (
  id              uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals (id) on delete cascade,
  title           text not null default 'Nova conversa' check (char_length(title) between 1 and 120),
  -- Contexto opcional do modo triagem: a conversa nasce vinculada a um
  -- orçamento do próprio profissional para a IA analisar. Nulo = chat livre.
  quote_request_id uuid references public.quote_requests (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_assistant_conversations_owner
  on public.assistant_conversations (professional_id, updated_at desc);

create trigger trg_assistant_conversations_touch before update on public.assistant_conversations
  for each row execute function public.touch_updated_at();

alter table public.assistant_conversations enable row level security;

create policy "assistant_conversations_owner_all"
  on public.assistant_conversations for all to authenticated
  using ((select auth.uid()) = professional_id)
  with check ((select auth.uid()) = professional_id);

grant select, insert, update, delete on public.assistant_conversations to authenticated;
revoke all on public.assistant_conversations from anon;


create table public.assistant_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations (id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'system')),
  content         text not null check (char_length(content) between 1 and 8000),
  -- Metadados de custo/observabilidade — não exibidos ao profissional, só
  -- para auditar gasto por conversa/modelo se o custo da OpenAI virar
  -- problema.
  model             text,
  prompt_tokens     integer,
  completion_tokens integer,
  created_at        timestamptz not null default now()
);

create index idx_assistant_messages_conversation
  on public.assistant_messages (conversation_id, created_at asc);

alter table public.assistant_messages enable row level security;

-- Sem policy de update/delete: histórico de conversa com IA é log, não se
-- edita — mesma filosofia de `messages`.
create policy "assistant_messages_owner_read"
  on public.assistant_messages for select to authenticated
  using (
    exists (
      select 1 from public.assistant_conversations c
      where c.id = conversation_id and c.professional_id = (select auth.uid())
    )
  );

create policy "assistant_messages_owner_insert"
  on public.assistant_messages for insert to authenticated
  with check (
    exists (
      select 1 from public.assistant_conversations c
      where c.id = conversation_id and c.professional_id = (select auth.uid())
    )
  );

grant select, insert on public.assistant_messages to authenticated;
revoke all on public.assistant_messages from anon;

comment on table public.assistant_conversations is
  'Histórico de conversas do profissional com o assistente de IA (V1: chat técnico HVAC + triagem opcional de orçamento). Sem relação com Chatwoot/conversations — é técnico↔IA, não técnico↔cliente.';
comment on table public.assistant_messages is
  'Mensagens de uma assistant_conversations. role=system só existiria se algum dia precisarmos persistir um system prompt customizado por conversa; V1 usa system prompt fixo no servidor, não gravado aqui.';

-- ---------------------------------------------------------------------------
-- Rate limit — reaproveita o primitivo já existente (20260813184012)
-- ---------------------------------------------------------------------------
-- Roda com o JWT do próprio profissional via Route Handler autenticado, não
-- service_role — por isso libera para `authenticated` diretamente (a
-- chamada acontece de dentro da rota de chat, antes de acionar a OpenAI).
create or replace function public.consumir_limite_assistente()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Limite do assistente exige um usuário autenticado.';
  end if;

  -- Tetos iniciais conservadores: uma IA paga por token é custo direto, não
  -- storage. Ajustar depois de ver consumo real em produção.
  perform public.consume_rate_limit('assistente_ia_minute', v_uid, 6, 60);
  perform public.consume_rate_limit('assistente_ia_day', v_uid, 60, 86400);
end;
$$;

revoke all on function public.consumir_limite_assistente() from public, anon;
grant execute on function public.consumir_limite_assistente() to authenticated;

comment on function public.consumir_limite_assistente() is
  'Teto de chamadas ao assistente de IA por profissional (6/min, 60/dia). Chamada pelo Route Handler antes de acionar a OpenAI — estoura exceção que vira HTTP 429.';

-- ---------------------------------------------------------------------------
-- Feature flag de rollout — kill switch independente do gate de plano
-- ---------------------------------------------------------------------------
-- Mesmo desenho de `chatwoot_messaging` (20260815095000): nasce desligada,
-- rollout zero, por região. `plano_permite('assistente')` decide QUEM pode
-- usar (plano Master); esta flag decide SE a feature está no ar agora,
-- independente de plano — permite ligar para um profissional de teste antes
-- de abrir geral, e desligar na hora se o custo da OpenAI sair do controle.
insert into public.feature_flags (flag_key, region_id, description, enabled, rollout_percentage)
select f.flag_key, r.id, f.description, f.enabled, f.rollout
  from public.marketplace_regions r
 cross join (values
   ('assistente_ia', 'Assistente de IA do profissional (chat + triagem de orçamento)', false, 0)
 ) as f(flag_key, description, enabled, rollout)
 where r.slug = 'sao-paulo-sp'
   and not exists (
     select 1 from public.feature_flags ff
      where ff.flag_key = f.flag_key and ff.region_id = r.id
   );
