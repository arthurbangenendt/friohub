-- ============================================================================
-- DISTRIBUIDORA COMO ATOR DO SISTEMA
--
-- Até aqui a distribuidora era o texto `products.supplier = 'Leveros'`. Não havia
-- cadastro, login, catálogo próprio, estoque nem repasse de pedido — ou seja, o
-- terceiro lado do marketplace não existia. Esta migration cria o papel, o
-- portal e o caminho do dropship.
--
-- PREÇO — decisão registrada. A distribuidora informa o CUSTO; o preço de venda
-- é derivado por markup da plataforma (`platform_config.markup_produto_pct`),
-- com override manual do admin (`products.preco_manual`). Assim a distribuidora
-- nunca define quanto o cliente paga, e a margem continua sendo nossa. Os 32
-- produtos Leveros já existentes entram como `preco_manual = true` para
-- preservar os preços curados — nenhum valor muda com esta migration.
--
-- RECURSÃO — lição de 20260812250000: policy que precisa ler outra tabela com
-- RLS faz isso por função SECURITY DEFINER, nunca por subquery direta. Todos os
-- predicados abaixo seguem essa regra.
--
-- GRANTS — `products` teve o SELECT de tabela revogado em 20260812220100 e usa
-- allowlist por coluna. Coluna nova nasce INVISÍVEL até receber grant explícito;
-- os grants das colunas novas estão no item 3.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Papel novo
--
--    O CHECK de `profiles.role` e o allowlist de `handle_new_user` precisam
--    mudar JUNTOS. Se só o CHECK mudar, o cadastro de distribuidora vira cliente
--    em silêncio; se só a função mudar, todo signup do papel novo falha.
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('cliente', 'profissional', 'distribuidora', 'admin'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role     text := coalesce(new.raw_user_meta_data->>'role', 'cliente');
  v_telefone text := nullif(new.raw_user_meta_data->>'telefone', '');
  v_cpf_cnpj text := nullif(new.raw_user_meta_data->>'cpf_cnpj', '');
  v_termos   text := nullif(new.raw_user_meta_data->>'termos_versao', '');
begin
  -- 'admin' continua fora: nunca sai de cadastro público.
  if v_role not in ('cliente', 'profissional', 'distribuidora') then
    v_role := 'cliente';
  end if;

  insert into public.profiles (id, role, nome)
  values (
    new.id,
    v_role,
    coalesce(nullif(new.raw_user_meta_data->>'nome', ''), split_part(new.email, '@', 1))
  );

  if v_telefone is not null or v_cpf_cnpj is not null or v_termos is not null then
    insert into public.profile_private (id, telefone, cpf_cnpj, termos_versao, termos_aceitos_em)
    values (
      new.id, v_telefone, v_cpf_cnpj, v_termos,
      case when v_termos is not null then now() else null end
    );
  end if;

  return new;
end;
$$;

-- `protege_role_profile` força 'cliente' em INSERT vindo do app. O trigger de
-- cadastro é SECURITY DEFINER e roda como dono, então não passa por ele — o
-- papel escolhido no signup continua valendo. Nada a mudar lá.

-- ---------------------------------------------------------------------------
-- 2. Distribuidoras
-- ---------------------------------------------------------------------------
create table if not exists public.distributors (
  id                  uuid primary key references public.profiles (id) on delete cascade,
  razao_social        text not null,
  cnpj                text,
  cidade              text not null,
  estado              text not null default 'SP',
  prazo_entrega_dias  int  not null default 5 check (prazo_entrega_dias between 0 and 90),

  verification_status text not null default 'pendente'
                      check (verification_status in ('pendente', 'em_analise', 'verificado', 'rejeitado')),
  verified_at         timestamptz,
  ativo               boolean not null default false,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.distributors is
  'Terceiro lado do marketplace. Só distribuidora verificada E ativa tem produto visível no catálogo.';

create trigger trg_distributors_touch before update on public.distributors
  for each row execute function public.touch_updated_at();

-- Onde entrega. Sem linha nenhuma = entrega em toda a praça.
create table if not exists public.distributor_areas (
  id             uuid primary key default gen_random_uuid(),
  distributor_id uuid not null references public.distributors (id) on delete cascade,
  uf             text not null,
  cep_prefix     text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_dist_areas on public.distributor_areas (distributor_id);

/* Distribuidora não se autoverifica nem se autoativa — mesma trava por coluna
   de `protege_confianca_professional`. Não é SECURITY DEFINER de propósito:
   precisa enxergar o papel real de quem executa. */
create or replace function public.protege_confianca_distributor()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if public.eh_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.verification_status := 'em_analise';
    new.verified_at         := null;
    new.ativo               := false;
  else
    -- rebaixar-se é permitido; promover-se, não
    if not (old.verification_status = 'verificado' and new.verification_status = 'em_analise') then
      new.verification_status := old.verification_status;
    end if;
    new.verified_at := old.verified_at;
    new.ativo       := old.ativo;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_distributors_protege on public.distributors;
create trigger trg_distributors_protege
  before insert or update on public.distributors
  for each row execute function public.protege_confianca_distributor();

-- ---------------------------------------------------------------------------
-- 3. Produtos passam a ter dono, estoque e preço derivado
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists distributor_id      uuid references public.distributors (id) on delete cascade,
  add column if not exists estoque_disponivel  boolean not null default true,
  add column if not exists preco_manual        boolean not null default false;

comment on column public.products.preco_manual is
  'true = preço definido a mão pelo admin. false = derivado do custo pelo markup da plataforma.';

alter table public.platform_config
  add column if not exists markup_produto_pct numeric(5,4) not null default 0.25
    check (markup_produto_pct >= 0);

comment on column public.platform_config.markup_produto_pct is
  'Markup sobre o custo informado pela distribuidora. preco_venda = custo * (1 + markup), salvo override.';

-- Colunas novas precisam de grant explícito: a tabela usa allowlist por coluna
-- desde 20260812220100. `custo` e `preco_manual` seguem fora — custo é segredo
-- comercial da distribuidora, e preco_manual é controle interno.
grant select (distributor_id, estoque_disponivel) on public.products to anon, authenticated;

/* Preço de venda derivado do custo. A distribuidora informa o custo e não toca
   no preço final; o admin pode fixar um preço marcando `preco_manual`. */
create or replace function public.aplica_markup_produto()
returns trigger
language plpgsql
as $$
declare
  v_markup numeric;
begin
  if new.preco_manual then
    return new;
  end if;
  select markup_produto_pct into v_markup from public.platform_config where id;
  new.preco_venda := round(coalesce(new.custo, 0) * (1 + coalesce(v_markup, 0.25)), 2);
  return new;
end;
$$;

drop trigger if exists trg_products_markup on public.products;
create trigger trg_products_markup
  before insert or update of custo, preco_manual on public.products
  for each row execute function public.aplica_markup_produto();

/* A distribuidora não escreve preço final nem estado de curadoria. RLS é por
   linha; esta trava é por coluna — mesmo padrão das outras. */
create or replace function public.protege_produto()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if public.eh_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.preco_manual := false;
    new.distributor_id := coalesce(new.distributor_id, auth.uid());
  else
    new.preco_manual   := old.preco_manual;
    new.distributor_id := old.distributor_id;
    if old.preco_manual then
      new.preco_venda := old.preco_venda;   -- preço fixado pelo admin não se mexe
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_products_protege on public.products;
create trigger trg_products_protege
  before insert or update on public.products
  for each row execute function public.protege_produto();

-- ---------------------------------------------------------------------------
-- 4. Backfill: a Leveros vira uma distribuidora de verdade
--
--    Preços atuais são curados (vieram do site da Leveros), então entram como
--    `preco_manual = true`. Nenhum valor muda aqui — o trigger de markup não
--    toca em preço manual.
-- ---------------------------------------------------------------------------
do $$
declare
  v_uid  uuid;
  v_dist uuid;
begin
  -- Sem conta de login ainda: a linha nasce ligada ao admin do sistema, e a
  -- Leveros assume quando se cadastrar. Melhor do que deixar produto órfão.
  select id into v_uid from public.profiles where role = 'admin' order by created_at limit 1;
  if v_uid is null then
    raise notice 'Sem admin na base — backfill da Leveros ignorado.';
    return;
  end if;

  select id into v_dist from public.distributors where razao_social = 'Leveros';
  if v_dist is null then
    insert into public.distributors (id, razao_social, cidade, estado, verification_status, verified_at, ativo)
    values (v_uid, 'Leveros', 'São Paulo', 'SP', 'verificado', now(), true)
    on conflict (id) do update
      set razao_social = 'Leveros', verification_status = 'verificado', ativo = true
    returning id into v_dist;
  end if;

  update public.products
     set distributor_id = v_dist, preco_manual = true
   where distributor_id is null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Repasse do pedido (dropship)
-- ---------------------------------------------------------------------------
create table if not exists public.purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null unique references public.orders (id) on delete cascade,
  distributor_id uuid not null references public.distributors (id) on delete restrict,

  status         text not null default 'a_repassar'
                 check (status in ('a_repassar', 'confirmado', 'faturado', 'enviado', 'entregue', 'cancelado')),

  custo_snapshot   numeric(10,2) not null default 0,  -- custo no momento da compra
  codigo_rastreio  text,
  nota_fiscal_url  text,
  prazo_previsto   date,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on column public.purchase_orders.custo_snapshot is
  'Congela o custo no momento da compra: mudança de tabela da distribuidora depois não reescreve a margem já realizada.';

create index if not exists idx_po_dist on public.purchase_orders (distributor_id, created_at desc);

create trigger trg_purchase_orders_touch before update on public.purchase_orders
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Predicados para as policies (SECURITY DEFINER — sem recursão)
-- ---------------------------------------------------------------------------
create or replace function public.distribuidora_ativa(p_distributor_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.distributors d
     where d.id = p_distributor_id and d.ativo and d.verification_status = 'verificado'
  );
$$;

/** O cliente enxerga o andamento da entrega do próprio pedido. */
create or replace function public.cliente_da_purchase_order(p_order_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.orders o
      join public.jobs j on j.id = o.job_id
     where o.id = p_order_id and j.cliente_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------
alter table public.distributors      enable row level security;
alter table public.distributor_areas enable row level security;
alter table public.purchase_orders   enable row level security;

-- Vitrine: quem compra precisa saber de quem vem o aparelho.
drop policy if exists "dist_read_all" on public.distributors;
create policy "dist_read_all" on public.distributors for select using (true);

drop policy if exists "dist_write_self" on public.distributors;
create policy "dist_write_self" on public.distributors for all
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "dist_admin_update" on public.distributors;
create policy "dist_admin_update" on public.distributors for update
  using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists "dist_areas_read" on public.distributor_areas;
create policy "dist_areas_read" on public.distributor_areas for select using (true);

drop policy if exists "dist_areas_own" on public.distributor_areas;
create policy "dist_areas_own" on public.distributor_areas for all
  using (distributor_id = auth.uid()) with check (distributor_id = auth.uid());

-- Catálogo público: só produto ativo, com estoque, de distribuidora verificada.
drop policy if exists "products_read_all" on public.products;
create policy "products_read_all" on public.products for select
  using (
    (ativo and estoque_disponivel and public.distribuidora_ativa(distributor_id))
    or distributor_id = auth.uid()
    or public.eh_admin()
  );

drop policy if exists "products_dist_write" on public.products;
create policy "products_dist_write" on public.products for all
  using (distributor_id = auth.uid()) with check (distributor_id = auth.uid());

drop policy if exists "products_admin_write" on public.products;
create policy "products_admin_write" on public.products for all
  using (public.eh_admin()) with check (public.eh_admin());

-- Repasse: a distribuidora vê e movimenta os seus; o cliente lê pela view do
-- item 8; o admin vê tudo.
drop policy if exists "po_dist_read" on public.purchase_orders;
create policy "po_dist_read" on public.purchase_orders for select
  using (distributor_id = auth.uid() or public.eh_admin());

drop policy if exists "po_dist_update" on public.purchase_orders;
create policy "po_dist_update" on public.purchase_orders for update
  using (distributor_id = auth.uid() or public.eh_admin())
  with check (distributor_id = auth.uid() or public.eh_admin());

/* Ninguém INSERE repasse pela API: ele nasce junto com a order, dentro de
   `aceitar_quote`. Sem policy de insert, a porta fica fechada. */

-- ---------------------------------------------------------------------------
-- 8. Visões enxutas
--
--    `custo` e `custo_snapshot` não podem vazar. Mesmo padrão de
--    `orders_cliente` (20260812130000): view roda como dona, e o filtro por
--    auth.uid() é a única barreira — não alterar sem entender isso.
-- ---------------------------------------------------------------------------
drop view if exists public.meus_produtos;
create view public.meus_produtos with (security_invoker = off) as
  select p.id, p.marca, p.modelo, p.btu, p.categoria, p.preco_venda, p.custo,
         p.preco_manual, p.image_url, p.ativo, p.estoque_disponivel, p.distributor_id, p.created_at
    from public.products p
   where p.distributor_id = auth.uid();

comment on view public.meus_produtos is
  'A distribuidora vê o próprio custo. Autorização vem do filtro por auth.uid().';

revoke all on public.meus_produtos from anon;
grant select on public.meus_produtos to authenticated;

drop view if exists public.entregas_cliente;
create view public.entregas_cliente with (security_invoker = off) as
  select po.id, po.order_id, o.job_id, po.status, po.codigo_rastreio,
         po.prazo_previsto, po.created_at, po.updated_at,
         d.razao_social as distribuidora
    from public.purchase_orders po
    join public.orders o on o.id = po.order_id
    join public.jobs   j on j.id = o.job_id
    join public.distributors d on d.id = po.distributor_id
   where j.cliente_id = auth.uid() or j.profissional_id = auth.uid();

comment on view public.entregas_cliente is
  'Andamento da entrega para cliente e profissional do job. Sem custo_snapshot.';

revoke all on public.entregas_cliente from anon;
grant select on public.entregas_cliente to authenticated;

-- ---------------------------------------------------------------------------
-- 9. O aceite passa a gerar o repasse
--
--    Redefine `aceitar_quote` de 20260812240000 acrescentando a purchase_order.
--    Todo o resto é idêntico — a redefinição é integral porque
--    `create or replace function` substitui o corpo inteiro.
-- ---------------------------------------------------------------------------
create or replace function public.aceitar_quote(p_quote_id uuid, p_endereco text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote   public.quotes%rowtype;
  v_req     public.quote_requests%rowtype;
  v_pct     numeric;
  v_servico numeric(10,2);
  v_venda   numeric(10,2) := 0;
  v_custo   numeric(10,2) := 0;
  v_dist    uuid;
  v_prazo   int := 5;
  v_job_id  uuid;
  v_order_id uuid;
begin
  select * into v_quote from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'Proposta não encontrada.';
  end if;

  select * into v_req from public.quote_requests where id = v_quote.quote_request_id;

  if v_req.cliente_id is distinct from auth.uid() then
    raise exception 'Apenas o cliente do pedido pode aceitar a proposta.';
  end if;
  if v_quote.status <> 'enviada' then
    raise exception 'Esta proposta não está mais disponível.';
  end if;
  if v_quote.validade_ate < current_date then
    raise exception 'Esta proposta venceu em %.', to_char(v_quote.validade_ate, 'DD/MM/YYYY');
  end if;
  if v_req.status <> 'aberto' then
    raise exception 'Este pedido de orçamento já foi encerrado.';
  end if;

  v_servico := case
    when v_quote.tipo = 'visita_tecnica' then v_quote.valor_visita
    else v_quote.valor_mao_obra + v_quote.valor_materiais
  end;

  if v_req.produto_id is not null then
    select p.preco_venda, p.custo, p.distributor_id, d.prazo_entrega_dias
      into v_venda, v_custo, v_dist, v_prazo
      from public.products p
      left join public.distributors d on d.id = p.distributor_id
     where p.id = v_req.produto_id;
  end if;

  insert into public.jobs (
    cliente_id, job_type, has_equipment, cep, endereco, cidade, descricao,
    produto_id, btu_recomendado, area_m2, ambiente, num_pessoas,
    insolacao_alta, andar_ou_telhado,
    profissional_id, status
  ) values (
    v_req.cliente_id, v_req.job_type, v_req.produto_id is not null, v_req.cep,
    nullif(btrim(coalesce(p_endereco, '')), ''), v_req.cidade, v_req.descricao,
    v_req.produto_id, v_req.btu_recomendado,
    nullif(v_req.detalhes->>'area_m2', '')::numeric,
    nullif(v_req.detalhes->>'ambiente', ''),
    nullif(v_req.detalhes->>'num_pessoas', '')::int,
    nullif(v_req.detalhes->>'insolacao_alta', '')::boolean,
    nullif(v_req.detalhes->>'andar_ou_telhado', '')::boolean,
    v_quote.professional_id, 'aguardando_profissional'
  )
  returning id into v_job_id;

  select comissao_servico_pct into v_pct from public.platform_config where id;

  insert into public.orders (
    job_id, preco_produto, preco_servico, comissao_servico, margem_produto, total, payment_status
  ) values (
    v_job_id,
    coalesce(v_venda, 0),
    v_servico,
    round(v_servico * coalesce(v_pct, 0.15), 2),
    coalesce(v_venda, 0) - coalesce(v_custo, 0),
    coalesce(v_venda, 0) + v_servico,
    'pendente'
  )
  returning id into v_order_id;

  -- Dropship: havendo aparelho, nasce o repasse para a distribuidora.
  if v_dist is not null then
    insert into public.purchase_orders (order_id, distributor_id, custo_snapshot, prazo_previsto)
    values (v_order_id, v_dist, coalesce(v_custo, 0),
            current_date + coalesce(v_prazo, 5));
  end if;

  update public.quotes set status = 'aceita', job_id = v_job_id where id = p_quote_id;

  update public.quotes
     set status = 'recusada'
   where quote_request_id = v_req.id
     and id <> p_quote_id
     and status = 'enviada';

  update public.quote_requests set status = 'fechado' where id = v_req.id;

  return v_job_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Storage das fotos de produto
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('produtos', 'produtos', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "produtos_public_read" on storage.objects;
create policy "produtos_public_read" on storage.objects
  for select using (bucket_id = 'produtos');

drop policy if exists "produtos_owner_insert" on storage.objects;
create policy "produtos_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'produtos' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "produtos_owner_delete" on storage.objects;
create policy "produtos_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'produtos' and (storage.foldername(name))[1] = auth.uid()::text
  );
