-- ============================================================================
-- REPUTAÇÃO FORJÁVEL PELO CLIENTE, E VALORES FORJÁVEIS NA ORDER
--
-- `jobs_client_all` é `for all` sobre a linha inteira. RLS é por LINHA, não por
-- COLUNA — mesmo problema já tratado em 20260812170000 e 20260812200000. Aqui a
-- consequência é maior, porque `jobs.status` alimenta a reputação:
--
--   1. PATCH /rest/v1/jobs?id=eq.<job do cliente>  {"status":"concluido"}
--      → o trigger `bump_jobs_completed` (SECURITY DEFINER) credita jobs_completed
--   2. POST /rest/v1/reviews  {...}
--      → `reviews_client_ins` só exige `cliente_id = auth.uid()`. NÃO valida que o
--        job é do cliente, nem que o `professional_id` é o do job.
--
-- Ou seja: pela API pública dava para dar 5 estrelas a qualquer profissional — ou
-- 1 estrela num concorrente — sem nunca ter contratado nada. Isso anulava na
-- prática o que 20260812170000 (trava de reputação) e 20260812180000 (recálculo)
-- foram consertar.
--
-- O profissional tinha o espelho do problema: `jobs_prof_update` libera todas as
-- colunas, então trocar `job_type` redirecionava o crédito para outra
-- especialidade. (`profissional_id` já estava protegido: sem `with check`, o
-- Postgres reusa a expressão do `using`.)
--
-- E `orders`: `orders_owner_insert` deixava o cliente inserir a própria ordem com
-- os valores que quisesse — inclusive `comissao_servico: 0`. Não havia
-- `unique (job_id)`, então duas ordens no mesmo job também derrubavam a tela do
-- serviço, que lê com `.maybeSingle()`.
--
-- Correção no mesmo modelo das anteriores: trava por COLUNA via trigger, que
-- preserva em silêncio quando quem escreve é o app (`authenticated`/`anon`), e
-- deixa passar o que vem de função SECURITY DEFINER ou de migration.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Configuração da plataforma
--
--    A comissão vivia só no TypeScript (`lib/pricing.ts`). Como a ordem passa a
--    ser calculada no banco (item 4), a taxa precisa existir aqui — senão o valor
--    cobrado depende de um número que o servidor de aplicação manda junto, que é
--    exatamente o que estamos deixando de aceitar.
-- ---------------------------------------------------------------------------
create table if not exists public.platform_config (
  id                   boolean primary key default true check (id),
  comissao_servico_pct numeric(5,4) not null default 0.15 check (comissao_servico_pct between 0 and 1),
  updated_at           timestamptz not null default now()
);
comment on table public.platform_config is
  'Linha única (id = true). Fonte de verdade da comissão cobrada — o app apenas exibe.';

insert into public.platform_config (id) values (true) on conflict (id) do nothing;

alter table public.platform_config enable row level security;

-- Leitura pública: o profissional precisa ver a taxa que incide sobre ele, e a
-- tela do serviço mostra o percentual. Escrita só por admin do banco.
drop policy if exists "platform_config_read_all" on public.platform_config;
create policy "platform_config_read_all" on public.platform_config for select using (true);

-- ---------------------------------------------------------------------------
-- 2. Policies de `jobs`: uma por operação, em vez de um `for all`
--
--    O DELETE do cliente sai de propósito: era permitido pelo `for all` e nenhuma
--    tela usa. Apagar o job apagaria em cascata a order e a review — o caminho
--    correto para desistir é `cancelado`, liberado no trigger do item 3.
-- ---------------------------------------------------------------------------
drop policy if exists "jobs_client_all" on public.jobs;

create policy "jobs_client_select" on public.jobs for select
  using (auth.uid() = cliente_id);

create policy "jobs_client_insert" on public.jobs for insert
  with check (
    auth.uid() = cliente_id
    and status = 'aguardando_profissional'   -- o job nasce sempre no mesmo ponto
  );

create policy "jobs_client_update" on public.jobs for update
  using (auth.uid() = cliente_id)
  with check (auth.uid() = cliente_id);

-- ---------------------------------------------------------------------------
-- 3. Trava por coluna + máquina de estados do job
--
--    NÃO é security definer, de propósito: precisa enxergar o papel real de quem
--    executa. Dentro de uma função SECURITY DEFINER (o trigger de review do item
--    5, a função de ordem do item 4), `current_user` vira o dono e a escrita passa.
-- ---------------------------------------------------------------------------
create or replace function public.protege_job_transicao()
returns trigger
language plpgsql
as $$
declare
  v_uid uuid := auth.uid();
  v_ok  boolean := false;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;  -- triggers, funções definer, migrations, service_role
  end if;

  -- Identidade do job e colunas que decidem crédito de reputação: imutáveis.
  -- `cep`, `endereco` e `descricao` continuam editáveis — corrigir endereço é
  -- uso legítimo.
  new.cliente_id      := old.cliente_id;
  new.profissional_id := old.profissional_id;
  new.job_type        := old.job_type;
  new.produto_id      := old.produto_id;
  new.has_equipment   := old.has_equipment;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if v_uid = old.cliente_id then
    -- Cliente desiste enquanto o serviço não começou. Depois disso, não.
    v_ok := new.status = 'cancelado'
        and old.status in ('aguardando_profissional', 'aceito');

  elsif v_uid = old.profissional_id then
    v_ok := (old.status, new.status) in (
      ('aguardando_profissional', 'aceito'),
      ('aguardando_profissional', 'cancelado'),   -- recusar
      ('aceito',                  'em_execucao'),
      ('aceito',                  'cancelado'),
      ('em_execucao',             'concluido')
    );
  end if;

  -- 'concluido' → 'avaliado' não aparece aqui: quem faz essa transição é o
  -- trigger de `reviews` (item 5), que roda como dono e não passa por esta trava.

  if not v_ok then
    new.status := old.status;   -- preserva em silêncio, no padrão das outras travas
  end if;

  return new;
end;
$$;

comment on function public.protege_job_transicao is
  'Congela identidade do job e limita as transições de status ao que cada lado pode fazer. RLS é por linha; esta trava é por coluna.';

drop trigger if exists trg_jobs_protege on public.jobs;
create trigger trg_jobs_protege
  before update on public.jobs
  for each row execute function public.protege_job_transicao();

-- ---------------------------------------------------------------------------
-- 4. `orders` deixa de ser gravável pelo cliente
--
--    Passa a nascer só por esta função, que lê preço e custo do produto no banco
--    e calcula a comissão a partir de `platform_config`. O app manda apenas o
--    preço da mão de obra; margem e comissão não vêm mais de fora.
-- ---------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_job_unique;
-- Se houver duplicata histórica, a constraint falha aqui — de propósito: é sinal
-- de dado a limpar, não de constraint a afrouxar.
alter table public.orders add constraint orders_job_unique unique (job_id);

drop policy if exists "orders_owner_insert" on public.orders;

create or replace function public.criar_order(p_job_id uuid, p_preco_servico numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job     public.jobs%rowtype;
  v_venda   numeric(10,2) := 0;
  v_custo   numeric(10,2) := 0;
  v_pct     numeric;
  v_servico numeric(10,2) := greatest(coalesce(p_preco_servico, 0), 0);
  v_id      uuid;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if not found then
    raise exception 'Serviço não encontrado.';
  end if;

  -- SECURITY DEFINER ignora RLS, então a autorização é explícita aqui.
  -- `auth.uid()` continua sendo o usuário da requisição mesmo como definer.
  if v_job.cliente_id is distinct from auth.uid() then
    raise exception 'Apenas o cliente do serviço pode gerar a ordem.';
  end if;

  if v_job.produto_id is not null then
    select p.preco_venda, p.custo into v_venda, v_custo
      from public.products p
     where p.id = v_job.produto_id;
  end if;

  select comissao_servico_pct into v_pct from public.platform_config where id;

  insert into public.orders (
    job_id, preco_produto, preco_servico, comissao_servico, margem_produto, total, payment_status
  ) values (
    p_job_id,
    coalesce(v_venda, 0),
    v_servico,
    round(v_servico * coalesce(v_pct, 0.15), 2),
    coalesce(v_venda, 0) - coalesce(v_custo, 0),
    coalesce(v_venda, 0) + v_servico,
    'pendente'
  )
  on conflict (job_id) do nothing
  returning id into v_id;

  return v_id;   -- nulo quando a ordem já existia
end;
$$;

comment on function public.criar_order is
  'Único caminho de criação de order. Margem e comissão são calculadas no banco — o app não as informa.';

revoke all on function public.criar_order(uuid, numeric) from public;
grant execute on function public.criar_order(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Review só de job realmente prestado
--
--    Espelha `client_reviews_pro_insert` (20260812210000), que já estava correta:
--    o vínculo autor ↔ job ↔ contraparte é verificado no banco.
-- ---------------------------------------------------------------------------
drop policy if exists "reviews_client_ins" on public.reviews;
create policy "reviews_client_ins" on public.reviews for insert
  with check (
    cliente_id = auth.uid()
    and exists (
      select 1 from public.jobs j
       where j.id = reviews.job_id
         and j.cliente_id = auth.uid()
         and j.profissional_id = reviews.professional_id
         and j.status in ('concluido', 'avaliado')
    )
  );

-- A transição 'concluido' → 'avaliado' era feita pelo cliente num UPDATE direto
-- (server action `avaliarJob`). Com a trava do item 3 isso passa a ser preservado
-- em silêncio, então a transição migra para cá — onde acontece por consequência
-- da review existir, que é a regra de negócio de verdade.
create or replace function public.marca_job_avaliado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.jobs
     set status = 'avaliado'
   where id = new.job_id
     and status = 'concluido';
  return new;
end;
$$;

drop trigger if exists trg_review_marca_job on public.reviews;
create trigger trg_review_marca_job
  after insert on public.reviews
  for each row execute function public.marca_job_avaliado();

-- ---------------------------------------------------------------------------
-- 6. Reputação do cliente: só quem atendeu aquele cliente
--
--    A policy anterior checava apenas o PAPEL, então qualquer profissional lia a
--    avaliação de qualquer cliente da base — dossiê de gente com quem nunca
--    trabalhou. O comentário da própria tabela diz que a nota é informação
--    operacional; operacional é sobre o cliente que você vai atender.
-- ---------------------------------------------------------------------------
drop policy if exists "client_reviews_pro_read" on public.client_reviews;
create policy "client_reviews_pro_read" on public.client_reviews for select
  using (
    exists (
      select 1 from public.jobs j
       where j.cliente_id = client_reviews.cliente_id
         and j.profissional_id = auth.uid()
    )
    or exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- 7. `products.custo` deixa de ser público
--
--    `products_read_all` libera a linha inteira (`for select using (ativo)`). A UI
--    nunca mostrou o custo, mas GET /rest/v1/products?select=custo entregava. Hoje
--    é o custo da Leveros; quando houver distribuidoras cadastradas, é o preço de
--    compra delas exposto ao público e à concorrência.
--
--    Aqui a trava é privilégio de COLUNA, não uma view: `jobs` embute `products`
--    por FK em várias telas, e trocar a origem quebraria os embeds. Revogar a
--    coluna mantém tudo funcionando e some com o campo.
-- ---------------------------------------------------------------------------
revoke select (custo) on public.products from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Buckets com limite
--
--    `portfolio` e `perfil` são públicos e aceitavam qualquer arquivo, de qualquer
--    tamanho, de qualquer usuário autenticado — inclusive cliente, que não tem
--    portfólio. A validação existia só no navegador (`file.type.startsWith`), que
--    não vale nada contra upload direto na API.
--
--    Os dois editores já enviam apenas imagem (`accept="image/*"`), então a
--    restrição não muda nenhum caminho existente.
-- ---------------------------------------------------------------------------
update storage.buckets
   set file_size_limit    = 8388608,   -- 8 MB
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id in ('portfolio', 'perfil');
