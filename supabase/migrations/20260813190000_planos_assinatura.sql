-- ============================================================================
-- PLANOS DE ASSINATURA — oferta pública para profissionais
-- ============================================================================
--
-- Contexto e decisões desta migration:
--
--   1. `subscription_plans` já existia desde a init.sql, semeada com
--      ('Gratuito', 0) e ('Pro', 99.90). Esta migration NÃO recria a tabela e
--      NÃO apaga linha nenhuma: `professionals.subscription_plan_id` aponta
--      para elas e um delete quebraria a FK. Linhas superadas são desativadas.
--
--   2. Separa duas coisas que estavam misturadas:
--        - `ativo`   = o plano existe e pode estar vinculado a um profissional.
--        - `publico` = o plano aparece na vitrine (/planos).
--      O plano Gratuito continua ATIVO (é o estado real de quem não paga) mas
--      não é PÚBLICO — não é uma oferta, é a ausência de uma.
--
--   3. `features` guarda só a capacidade legível por máquina — é o que o
--      controle de acesso das telas vai ler depois. O texto de marketing mora
--      no front, onde se itera sem migration.
--
--   4. [RISCO 1] Isto NÃO liga cobrança. `city_billing_config.cobranca_ativa`
--      continua false em Fortaleza e nada aqui altera `subscription_status`.
--      `plan_interest` registra INTENÇÃO de assinar, não uma assinatura. Marcar
--      alguém como pagante sem gateway seria mentira no banco.
--
--   5. [RISCO 2] Nenhum plano compra posição na ordem orgânica da busca. O
--      `buscar_profissionais_marketplace` fica intocado. O que o plano dá é
--      cota de `featured_placements` — slot rotulado "Patrocinado", que já tem
--      trava de qualidade em `is_featured_eligible`. Vender ordem orgânica sem
--      rótulo é publicidade não identificada; o CDC não permite.

-- ---------------------------------------------------------------------------
-- 1. Colunas de vitrine
-- ---------------------------------------------------------------------------
alter table public.subscription_plans
  add column if not exists slug          text,
  add column if not exists preco_anual   numeric(10,2),
  add column if not exists headline      text,
  add column if not exists ordem         integer not null default 0,
  add column if not exists destaque      boolean not null default false,
  add column if not exists publico       boolean not null default false,
  add column if not exists featured_cota integer not null default 0;

comment on column public.subscription_plans.publico is
  'Aparece na vitrine /planos. O plano Gratuito é ativo mas não público: é estado, não oferta.';
comment on column public.subscription_plans.featured_cota is
  '[RISCO 2] Quantos featured_placements simultâneos o plano permite. Slot é rotulado, não é ordem orgânica.';
comment on column public.subscription_plans.preco_anual is
  'Preço do ciclo anual cheio (equivale a 10 mensalidades — 2 meses de desconto).';

-- Nulls são distintos por padrão no Postgres, então linhas legadas sem slug
-- convivem com o índice sem conflito.
create unique index if not exists subscription_plans_slug_key
  on public.subscription_plans (slug);

-- ---------------------------------------------------------------------------
-- 2. A oferta
-- ---------------------------------------------------------------------------
-- Batiza o Gratuito existente sem alterar seu id (a FK dos profissionais atuais
-- aponta para ele). Casa por nome porque é o único identificador que temos.
update public.subscription_plans
   set slug     = 'gratuito',
       publico  = false,
       ativo    = true,
       ordem    = 0,
       headline = 'Cadastro sem custo',
       features = '{"busca": false, "orcamentos": false, "financeiro": null,
                    "agenda": false, "custos_obra": false, "graficos": false,
                    "assistente": false, "equipe": 0}'::jsonb
 where nome = 'Gratuito' and slug is null;

-- Plano 'Pro' de 99.90 é superado pela linha de três. Desativado, não apagado:
-- se algum profissional estiver vinculado, o vínculo continua íntegro.
update public.subscription_plans
   set ativo = false, publico = false
 where nome = 'Pro' and slug is null;

insert into public.subscription_plans
  (nome, slug, preco_mensal, preco_anual, headline, ordem, destaque, publico, ativo, featured_cota, features)
values
  ('Essencial', 'essencial', 50.00, 500.00,
   'Para começar a receber serviço', 1, false, true, true, 0,
   '{"busca": true, "orcamentos": true, "financeiro": "basico",
     "agenda": false, "custos_obra": false, "graficos": false,
     "assistente": false, "equipe": 1}'::jsonb),

  ('Profissional', 'profissional', 100.00, 1000.00,
   'Para quem vive disso', 2, true, true, true, 1,
   '{"busca": true, "orcamentos": true, "financeiro": "completo",
     "agenda": true, "custos_obra": true, "graficos": true,
     "assistente": false, "equipe": 3}'::jsonb),

  ('Master', 'master', 300.00, 3000.00,
   'Para empresa que quer escalar', 3, false, true, true, 3,
   '{"busca": true, "orcamentos": true, "financeiro": "completo",
     "agenda": true, "custos_obra": true, "graficos": true,
     "assistente": true, "equipe": 10}'::jsonb)
on conflict (slug) do update set
  nome          = excluded.nome,
  preco_mensal  = excluded.preco_mensal,
  preco_anual   = excluded.preco_anual,
  headline      = excluded.headline,
  ordem         = excluded.ordem,
  destaque      = excluded.destaque,
  publico       = excluded.publico,
  ativo         = excluded.ativo,
  featured_cota = excluded.featured_cota,
  features      = excluded.features;

-- ---------------------------------------------------------------------------
-- 3. Registro de intenção
-- ---------------------------------------------------------------------------
-- [RISCO 1] Sem gateway, o botão "assinar" não pode cobrar. O que ele pode
-- fazer com honestidade é registrar quem quer qual plano — que é exatamente o
-- dado necessário para decidir se vale construir a cobrança.
create table if not exists public.plan_interest (
  id              uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals (id) on delete cascade,
  plan_id         uuid not null references public.subscription_plans (id),
  ciclo           text not null check (ciclo in ('mensal', 'anual')),
  origem          text not null default 'pagina_planos',
  created_at      timestamptz not null default now()
);
comment on table public.plan_interest is
  '[RISCO 1] Intenção de assinar, não assinatura. Não implica cobrança nem muda subscription_status.';

create index if not exists plan_interest_professional_idx
  on public.plan_interest (professional_id, created_at desc);
create index if not exists plan_interest_plan_idx
  on public.plan_interest (plan_id, created_at desc);

alter table public.plan_interest enable row level security;

-- O profissional enxerga o próprio histórico. A escrita é exclusiva do RPC
-- abaixo (security definer), que valida papel e plano antes de gravar.
drop policy if exists "plan_interest_self_read" on public.plan_interest;
create policy "plan_interest_self_read" on public.plan_interest
  for select using (professional_id = (select auth.uid()));

revoke all on table public.plan_interest from public, anon;
grant select on table public.plan_interest to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPC de registro
-- ---------------------------------------------------------------------------
create or replace function public.registrar_interesse_plano(
  p_slug  text,
  p_ciclo text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_plan_id uuid;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;

  if p_ciclo not in ('mensal', 'anual') then
    raise exception 'Ciclo inválido.';
  end if;

  -- Só profissional assina. Cliente que cair aqui recebe uma mensagem clara em
  -- vez de um erro de FK.
  if not exists (
    select 1 from public.professionals pr where pr.id = v_uid
  ) then
    raise exception 'Apenas perfis de profissional podem assinar um plano.';
  end if;

  select id into v_plan_id
    from public.subscription_plans
   where slug = p_slug and ativo and publico;

  if v_plan_id is null then
    raise exception 'Plano indisponível.';
  end if;

  -- Reclique no mesmo plano e ciclo no mesmo dia não vira linha nova: o dado
  -- que interessa é "quem quer o quê", não quantas vezes clicou.
  select id into v_id
    from public.plan_interest
   where professional_id = v_uid
     and plan_id = v_plan_id
     and ciclo = p_ciclo
     and created_at > now() - interval '24 hours'
   limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.plan_interest (professional_id, plan_id, ciclo)
  values (v_uid, v_plan_id, p_ciclo)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.registrar_interesse_plano(text, text) from public, anon;
grant execute on function public.registrar_interesse_plano(text, text) to authenticated;

comment on function public.registrar_interesse_plano(text, text) is
  '[RISCO 1] Registra intenção de assinar. Não cobra, não altera subscription_status.';
