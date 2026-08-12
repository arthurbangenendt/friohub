-- ============================================================================
-- FrioHub — schema inicial do MVP
-- Marketplace de HVAC residencial com receita de distribuidora (dropship).
--
-- As 4 soluções de risco estão embutidas no schema e marcadas com [RISCO N]:
--   [RISCO 1] Cold start .............. cobrança desligada por cidade; entrada grátis
--   [RISCO 2] Confiança x destaque .... slot patrocinado com trava de qualidade
--   [RISCO 3] Jobs só-serviço ......... tipos de job com/sem equipamento
--   [RISCO 4] Qualidade da rede ....... verificação + piso de qualidade
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensões
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. PERFIS  (todos os usuários — ligados ao auth.users do Supabase)
-- ============================================================================
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text not null default 'cliente'
              check (role in ('cliente', 'profissional', 'admin')),
  nome        text not null,
  telefone    text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.profiles is 'Perfil base de qualquer usuário (cliente, profissional ou admin).';

-- ============================================================================
-- 2. PROFISSIONAIS  (autônomos e empresas)
-- ============================================================================
create table public.professionals (
  id                  uuid primary key references public.profiles (id) on delete cascade,
  tipo                text not null check (tipo in ('autonomo', 'empresa')),
  razao_social        text,            -- para empresas
  cnpj                text,
  bio                 text,            -- descrição estilo "sobre" do LinkedIn
  cidade              text not null,
  estado              text not null default 'CE',

  -- [RISCO 4] Verificação / onboarding e piso de qualidade
  verification_status text not null default 'pendente'
                      check (verification_status in ('pendente', 'em_analise', 'verificado', 'rejeitado')),
  verified_at         timestamptz,

  -- [RISCO 1] Assinatura: existe no schema, mas começa grátis (cobrança desligada)
  subscription_status text not null default 'gratis'
                      check (subscription_status in ('gratis', 'trial', 'ativa', 'inadimplente', 'cancelada')),
  subscription_plan_id uuid,           -- FK definida após a tabela de planos

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on column public.professionals.subscription_status is
  '[RISCO 1] Começa em ''gratis''. A cobrança só liga quando city_billing_config.cobranca_ativa = true.';

-- Skills por especialidade — com AVALIAÇÃO SEPARADA por skill
-- (nota do profissional em ''instalacao'' ≠ nota em ''manutencao'')
create table public.professional_skills (
  id               uuid primary key default gen_random_uuid(),
  professional_id  uuid not null references public.professionals (id) on delete cascade,
  specialty        text not null
                   check (specialty in ('instalacao', 'manutencao', 'remanejamento', 'limpeza', 'conserto')),
  years_experience int  not null default 0,
  -- Agregados de reputação (recalculados por trigger a partir de reviews)
  rating_avg       numeric(3,2) not null default 0,   -- 0.00 – 5.00
  rating_count     int          not null default 0,
  jobs_completed   int          not null default 0,
  created_at       timestamptz  not null default now(),
  unique (professional_id, specialty)
);
comment on table public.professional_skills is
  'Diferencial vs. concorrentes: reputação é medida POR especialidade, não uma nota única.';

-- Áreas de atendimento (matching por CEP) — usamos prefixo do CEP para o MVP
create table public.service_areas (
  id               uuid primary key default gen_random_uuid(),
  professional_id  uuid not null references public.professionals (id) on delete cascade,
  cep_prefix       text not null,      -- ex.: '6001' cobre CEPs 6001xxxx
  cidade           text not null,
  created_at       timestamptz not null default now()
);
create index on public.service_areas (cep_prefix);

-- Portfólio (fotos e vídeos, estilo LinkedIn)
create table public.portfolio_items (
  id               uuid primary key default gen_random_uuid(),
  professional_id  uuid not null references public.professionals (id) on delete cascade,
  media_type       text not null check (media_type in ('foto', 'video')),
  url              text not null,
  caption          text,
  position         int  not null default 0,
  created_at       timestamptz not null default now()
);

-- ============================================================================
-- 3. CATÁLOGO DE PRODUTOS  (distribuidora, dropship)
-- ============================================================================
create table public.products (
  id            uuid primary key default gen_random_uuid(),
  marca         text not null,
  modelo        text not null,
  btu           int  not null,         -- 9000, 12000, 18000, 24000...
  categoria     text not null default 'split'
                check (categoria in ('split', 'inverter', 'multi_split', 'piso_teto', 'janela')),
  preco_venda   numeric(10,2) not null,   -- preço ao cliente
  custo         numeric(10,2) not null,   -- custo na distribuidora -> margem = venda - custo
  supplier      text,                     -- fornecedor do dropship
  image_url     text,
  ativo         boolean not null default true,
  created_at    timestamptz not null default now()
);
create index on public.products (btu) where ativo;
comment on column public.products.custo is 'Margem do equipamento (receita nº 1) = preco_venda - custo.';

-- ============================================================================
-- 4. JOBS  (pedidos de serviço)  — [RISCO 3] com/sem equipamento
-- ============================================================================
create table public.jobs (
  id                    uuid primary key default gen_random_uuid(),
  cliente_id            uuid not null references public.profiles (id) on delete cascade,

  -- [RISCO 3] Distingue o job que carrega equipamento (margem) do só-serviço (isca)
  job_type              text not null
                        check (job_type in ('instalacao_com_equipamento', 'manutencao',
                                            'remanejamento', 'limpeza', 'conserto')),
  has_equipment         boolean not null default false,

  -- Localização / matching
  cep                   text not null,
  endereco              text,
  cidade                text not null,

  -- Dados do ambiente + resultado da calculadora de BTU
  area_m2               numeric(6,2),
  ambiente              text,           -- 'sala', 'quarto'...
  andar_ou_telhado      boolean,        -- pega sol no teto?
  insolacao_alta        boolean,
  num_pessoas           int,
  btu_recomendado       int,            -- saída da calculadora

  -- Seleção
  produto_id            uuid references public.products (id),      -- nulo em jobs só-serviço
  profissional_id       uuid references public.professionals (id), -- escolhido pelo cliente

  status                text not null default 'aberto'
                        check (status in ('aberto', 'aguardando_profissional', 'aceito',
                                          'em_execucao', 'concluido', 'avaliado', 'cancelado')),
  descricao             text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on public.jobs (cliente_id);
create index on public.jobs (profissional_id);
create index on public.jobs (status);

-- ============================================================================
-- 5. PEDIDOS / PAGAMENTO
-- ============================================================================
create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.jobs (id) on delete cascade,

  preco_produto    numeric(10,2) not null default 0,  -- 0 em jobs só-serviço
  preco_servico    numeric(10,2) not null default 0,  -- mão de obra (preço tabelado)
  comissao_servico numeric(10,2) not null default 0,  -- receita nº 2
  margem_produto   numeric(10,2) not null default 0,  -- receita nº 1
  total            numeric(10,2) not null default 0,

  payment_status   text not null default 'pendente'
                   check (payment_status in ('pendente', 'pago', 'reembolsado', 'falhou')),
  payment_ref      text,              -- id do gateway (Pagar.me/Mercado Pago) — fase 2
  created_at       timestamptz not null default now()
);
create index on public.orders (job_id);

-- ============================================================================
-- 6. AVALIAÇÕES  — alimentam a reputação por skill
-- ============================================================================
create table public.reviews (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.jobs (id) on delete cascade,
  cliente_id       uuid not null references public.profiles (id) on delete cascade,
  professional_id  uuid not null references public.professionals (id) on delete cascade,
  specialty        text not null
                   check (specialty in ('instalacao', 'manutencao', 'remanejamento', 'limpeza', 'conserto')),
  rating           int  not null check (rating between 1 and 5),
  comment          text,
  created_at       timestamptz not null default now(),
  unique (job_id)  -- uma avaliação por job
);

-- ============================================================================
-- 7. MONETIZAÇÃO  (construída agora, cobrança ligada depois)
-- ============================================================================

-- Planos de assinatura
create table public.subscription_plans (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  preco_mensal  numeric(10,2) not null,
  features      jsonb not null default '{}'::jsonb,
  ativo         boolean not null default true,
  created_at    timestamptz not null default now()
);

-- FK atrasada de professionals -> subscription_plans
alter table public.professionals
  add constraint professionals_plan_fk
  foreign key (subscription_plan_id) references public.subscription_plans (id);

-- [RISCO 1] Interruptor de cobrança POR CIDADE. Piloto entra com cobranca_ativa = false.
create table public.city_billing_config (
  cidade          text primary key,
  cobranca_ativa  boolean not null default false,
  updated_at      timestamptz not null default now()
);
comment on table public.city_billing_config is
  '[RISCO 1] Cold start: na cidade piloto cobranca_ativa=false (entrada grátis). Liga quando houver fluxo.';

-- [RISCO 2] Destaque patrocinado
create table public.featured_placements (
  id               uuid primary key default gen_random_uuid(),
  professional_id  uuid not null references public.professionals (id) on delete cascade,
  specialty        text not null
                   check (specialty in ('instalacao', 'manutencao', 'remanejamento', 'limpeza', 'conserto')),
  cidade           text not null,
  starts_at        timestamptz not null default now(),
  ends_at          timestamptz not null,
  ativo            boolean not null default true,
  created_at       timestamptz not null default now()
);
create index on public.featured_placements (cidade, specialty) where ativo;

-- Trava de qualidade do patrocinado: nota mínima e nº mínimo de serviços na skill.
-- Só é elegível a comprar destaque quem já é bom — patrocinado nunca é profissional ruim.
create or replace function public.is_featured_eligible(
  p_professional_id uuid,
  p_specialty       text,
  p_min_rating      numeric default 4.0,
  p_min_jobs        int     default 5
) returns boolean
language sql stable as $$
  select coalesce(
    (select ps.rating_avg >= p_min_rating and ps.jobs_completed >= p_min_jobs
       from public.professional_skills ps
      where ps.professional_id = p_professional_id
        and ps.specialty = p_specialty),
    false)
    and exists (
      select 1 from public.professionals pr
       where pr.id = p_professional_id
         and pr.verification_status = 'verificado'   -- [RISCO 4] tem que ser verificado
    );
$$;
comment on function public.is_featured_eligible is
  '[RISCO 2] Só profissional verificado, com nota e histórico mínimos, pode ser patrocinado.';

-- ============================================================================
-- 8. TRIGGERS  — mantêm agregados de reputação e updated_at
-- ============================================================================

-- updated_at automático
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

create trigger trg_profiles_touch      before update on public.profiles      for each row execute function public.touch_updated_at();
create trigger trg_professionals_touch before update on public.professionals for each row execute function public.touch_updated_at();
create trigger trg_jobs_touch          before update on public.jobs          for each row execute function public.touch_updated_at();

-- Recalcula rating_avg / rating_count da skill quando uma review entra
create or replace function public.recalc_skill_rating()
returns trigger language plpgsql as $$
begin
  update public.professional_skills ps
     set rating_avg = sub.avg_rating,
         rating_count = sub.cnt
    from (
      select avg(rating)::numeric(3,2) as avg_rating, count(*) as cnt
        from public.reviews
       where professional_id = new.professional_id
         and specialty = new.specialty
    ) sub
   where ps.professional_id = new.professional_id
     and ps.specialty = new.specialty;
  return new;
end; $$;
create trigger trg_review_recalc after insert on public.reviews
  for each row execute function public.recalc_skill_rating();

-- Incrementa jobs_completed quando um job é concluído
create or replace function public.bump_jobs_completed()
returns trigger language plpgsql as $$
begin
  if new.status = 'concluido' and old.status <> 'concluido'
     and new.profissional_id is not null then
    update public.professional_skills ps
       set jobs_completed = jobs_completed + 1
     where ps.professional_id = new.profissional_id
       and ps.specialty = (case
             when new.job_type = 'instalacao_com_equipamento' then 'instalacao'
             else new.job_type end);
  end if;
  return new;
end; $$;
create trigger trg_job_completed after update on public.jobs
  for each row execute function public.bump_jobs_completed();

-- ============================================================================
-- 9. ROW LEVEL SECURITY
-- ============================================================================
alter table public.profiles             enable row level security;
alter table public.professionals         enable row level security;
alter table public.professional_skills   enable row level security;
alter table public.service_areas         enable row level security;
alter table public.portfolio_items       enable row level security;
alter table public.products              enable row level security;
alter table public.jobs                  enable row level security;
alter table public.orders                enable row level security;
alter table public.reviews               enable row level security;
alter table public.subscription_plans    enable row level security;
alter table public.city_billing_config   enable row level security;
alter table public.featured_placements   enable row level security;

-- Perfis: cada um lê/edita o seu; qualquer autenticado pode ler (para exibir nome do profissional)
create policy "profiles_self_all"   on public.profiles for all    using (auth.uid() = id) with check (auth.uid() = id);
create policy "profiles_read_auth"  on public.profiles for select using (auth.role() = 'authenticated');

-- Vitrine pública do profissional: leitura liberada; escrita só do dono
create policy "prof_read_all"   on public.professionals       for select using (true);
create policy "prof_write_self" on public.professionals       for all    using (auth.uid() = id) with check (auth.uid() = id);
create policy "skills_read_all"  on public.professional_skills for select using (true);
create policy "skills_write_own" on public.professional_skills for all
  using (auth.uid() = professional_id) with check (auth.uid() = professional_id);
create policy "areas_read_all"   on public.service_areas       for select using (true);
create policy "areas_write_own"  on public.service_areas       for all
  using (auth.uid() = professional_id) with check (auth.uid() = professional_id);
create policy "portfolio_read_all"  on public.portfolio_items  for select using (true);
create policy "portfolio_write_own" on public.portfolio_items  for all
  using (auth.uid() = professional_id) with check (auth.uid() = professional_id);

-- Catálogo e planos: leitura pública
create policy "products_read_all" on public.products          for select using (ativo);
create policy "plans_read_all"    on public.subscription_plans for select using (ativo);

-- Jobs: cliente vê os seus; profissional vê os jobs atribuídos a ele
create policy "jobs_client_all" on public.jobs for all
  using (auth.uid() = cliente_id) with check (auth.uid() = cliente_id);
create policy "jobs_prof_read"  on public.jobs for select using (auth.uid() = profissional_id);
create policy "jobs_prof_update" on public.jobs for update using (auth.uid() = profissional_id);

-- Orders: dono do job vê
create policy "orders_owner_read" on public.orders for select
  using (exists (select 1 from public.jobs j where j.id = job_id and (j.cliente_id = auth.uid() or j.profissional_id = auth.uid())));

-- Reviews: leitura pública; cliente cria a sua
create policy "reviews_read_all"   on public.reviews for select using (true);
create policy "reviews_client_ins" on public.reviews for insert with check (auth.uid() = cliente_id);

-- Destaques: leitura pública (para renderizar "Patrocinado")
create policy "featured_read_all" on public.featured_placements for select using (ativo);

-- city_billing_config: leitura pública (a UI precisa saber se cobra ou não)
create policy "billing_read_all"  on public.city_billing_config for select using (true);

-- ============================================================================
-- 10. SEED mínimo  (cidade piloto com cobrança desligada + planos)
-- ============================================================================
insert into public.city_billing_config (cidade, cobranca_ativa)
values ('Fortaleza', false);   -- [RISCO 1] piloto entra grátis

insert into public.subscription_plans (nome, preco_mensal, features) values
  ('Gratuito', 0,   '{"leads": "ilimitados", "destaque": false}'),
  ('Pro',      99.90,'{"leads": "ilimitados", "destaque": true, "selo": true}');
