-- ============================================================================
-- Aceite de proposta com múltiplos ambientes
--
-- ATENÇÃO: esta migration mexe no caminho do dinheiro (jobs → orders →
-- purchase_orders). O que muda, exatamente:
--
--   1. `job_itens` congela o escopo contratado — um registro por ambiente, com
--      preço de venda e custo do aparelho no momento do aceite. Sem snapshot, a
--      distribuidora mudar a tabela amanhã reescreveria a margem já realizada.
--
--   2. `orders.preco_produto` e `margem_produto` passam a ser a SOMA dos itens.
--      Para pedido de um ambiente só, o resultado é numericamente idêntico ao
--      de hoje — a fórmula não mudou, o conjunto somado é que cresceu.
--
--   3. `purchase_orders.order_id` deixa de ser UNIQUE e passa a ser
--      UNIQUE (order_id, distributor_id). Três aparelhos de três distribuidoras
--      são três ordens de compra; não há como uma linha só representar isso.
--      É um RELAXAMENTO: toda linha existente continua válida, e as duas telas
--      de distribuidora já consultam a tabela como lista filtrada por
--      distributor_id, sem assumir uma por order.
--
--   4. `purchase_orders.custo_snapshot` passa a ser a soma dos itens daquela
--      distribuidora naquele pedido.
--
-- As colunas singulares de `jobs` (produto_id, ambiente, area_m2, ...) seguem
-- preenchidas com o PRIMEIRO item, para não quebrar nenhuma tela existente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Escopo contratado, congelado no aceite
-- ---------------------------------------------------------------------------
create table if not exists public.job_itens (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.jobs (id) on delete cascade,
  ordem            int  not null check (ordem >= 1),

  ambiente         text not null,
  area_m2          numeric(6,2),
  num_pessoas      int,
  eletronicos      int,
  insolacao_alta   boolean not null default false,
  andar_ou_telhado boolean not null default false,
  btu_recomendado  int,

  produto_id       uuid references public.products (id),
  quantidade       int not null default 1 check (quantidade between 1 and 20),

  /* Snapshots. `preco_venda_snapshot` é o que o cliente deve; `custo_snapshot`
     é o que a distribuidora recebe. A diferença é a margem da plataforma, e ela
     não pode mudar depois que o negócio foi fechado. */
  preco_venda_snapshot numeric(10,2) not null default 0 check (preco_venda_snapshot >= 0),
  custo_snapshot       numeric(10,2) not null default 0 check (custo_snapshot >= 0),
  distributor_id       uuid references public.distributors (id),

  created_at       timestamptz not null default now(),

  unique (job_id, ordem)
);

create index if not exists idx_ji_job  on public.job_itens (job_id, ordem);
create index if not exists idx_ji_dist on public.job_itens (distributor_id);

comment on table public.job_itens is
  'Escopo contratado por ambiente, com preço e custo congelados no aceite da proposta.';

alter table public.job_itens enable row level security;

-- Mesma visibilidade do job: cliente dono, profissional contratado, admin.
drop policy if exists "ji_read" on public.job_itens;
create policy "ji_read" on public.job_itens for select
  using (
    exists (
      select 1 from public.jobs j
       where j.id = job_itens.job_id
         and (
           j.cliente_id = (select auth.uid())
           or j.profissional_id = (select auth.uid())
         )
    )
    or public.eh_admin()
  );

/* A distribuidora enxerga apenas os itens que ela mesma vai despachar — nunca o
   pedido inteiro do cliente, nem o que os concorrentes venderam no mesmo job. */
drop policy if exists "ji_distribuidora_read" on public.job_itens;
create policy "ji_distribuidora_read" on public.job_itens for select
  using (distributor_id = (select auth.uid()));

-- Escrita é exclusiva de aceitar_quote (SECURITY DEFINER). Ninguém insere item
-- contratado pela API: seria reescrever o valor de um negócio já fechado — por
-- isso o grant é somente de leitura.
grant select on public.job_itens to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Uma ordem de compra POR DISTRIBUIDORA
-- ---------------------------------------------------------------------------
alter table public.purchase_orders drop constraint if exists purchase_orders_order_id_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'purchase_orders_order_distribuidora_key'
       and conrelid = 'public.purchase_orders'::regclass
  ) then
    alter table public.purchase_orders
      add constraint purchase_orders_order_distribuidora_key
      unique (order_id, distributor_id);
  end if;
end $$;

comment on constraint purchase_orders_order_distribuidora_key on public.purchase_orders is
  'Um pedido com aparelhos de distribuidoras diferentes gera uma ordem de compra para cada uma.';

-- ---------------------------------------------------------------------------
-- 3. aceitar_quote com N ambientes
-- ---------------------------------------------------------------------------
create or replace function public.aceitar_quote(
  p_quote_id uuid,
  p_endereco text,
  p_detalhes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote       public.quotes%rowtype;
  v_req         public.quote_requests%rowtype;
  v_pct         numeric;
  v_servico     numeric(10,2);
  v_venda       numeric(10,2) := 0;
  v_custo       numeric(10,2) := 0;
  v_job_id      uuid;
  v_order_id    uuid;
  v_request_id  uuid;
  v_detalhes    jsonb;
  v_primeiro    public.quote_request_itens%rowtype;
  v_indisponivel text;
begin
  if (select auth.uid()) is null then
    raise exception 'Não autenticado.';
  end if;
  if nullif(btrim(coalesce(p_endereco, '')), '') is null then
    raise exception 'Informe o endereço completo do serviço.';
  end if;
  if char_length(p_endereco) > 500 then
    raise exception 'O endereço informado é muito longo.';
  end if;
  if p_detalhes is not null and jsonb_typeof(p_detalhes) <> 'object' then
    raise exception 'Detalhes técnicos precisam ser um objeto JSON.';
  end if;

  -- Lock do pedido antes do lock da proposta: chamadas concorrentes para
  -- propostas diferentes do mesmo pedido serializam aqui.
  select q.quote_request_id into v_request_id
    from public.quotes q
   where q.id = p_quote_id;
  if not found then
    raise exception 'Proposta não encontrada.';
  end if;

  select * into v_req
    from public.quote_requests
   where id = v_request_id
   for update;

  select * into v_quote
    from public.quotes
   where id = p_quote_id
     and quote_request_id = v_req.id
   for update;

  if not found then
    raise exception 'Proposta não encontrada.';
  end if;
  if v_req.cliente_id is distinct from (select auth.uid()) then
    raise exception 'Apenas o cliente do pedido pode aceitar a proposta.';
  end if;
  if v_req.status <> 'aberto' then
    raise exception 'Este pedido de orçamento já foi encerrado.';
  end if;
  if v_req.expira_em <= now() then
    raise exception 'Este pedido de orçamento expirou.';
  end if;
  if v_quote.status <> 'enviada' then
    raise exception 'Esta proposta não está mais disponível.';
  end if;
  if v_quote.validade_ate < current_date then
    raise exception 'Esta proposta venceu em %.', to_char(v_quote.validade_ate, 'DD/MM/YYYY');
  end if;

  v_detalhes := coalesce(v_req.detalhes, '{}'::jsonb) || coalesce(p_detalhes, '{}'::jsonb);

  v_servico := case
    when v_quote.tipo = 'visita_tecnica' then v_quote.valor_visita
    else v_quote.valor_mao_obra + v_quote.valor_materiais
  end;

  /* Todo aparelho do pedido é revalidado e travado agora. Um único item fora de
     estoque reprova o aceite inteiro: entregar 2 de 3 ambientes e cobrar por um
     pacote que não existe mais é pior do que recusar. */
  select string_agg(distinct i.ambiente, ', ' order by i.ambiente)
    into v_indisponivel
    from public.quote_request_itens i
   where i.quote_request_id = v_req.id
     and i.produto_id is not null
     and not exists (
       select 1
         from public.products p
         join public.distributors d on d.id = p.distributor_id
        where p.id = i.produto_id
          and p.ativo
          and p.estoque_disponivel
          and d.ativo
          and d.verification_status = 'verificado'
     );

  if v_indisponivel is not null then
    raise exception 'O equipamento escolhido para % não está mais disponível.', v_indisponivel;
  end if;

  perform 1
     from public.quote_request_itens i
     join public.products p     on p.id = i.produto_id
     join public.distributors d on d.id = p.distributor_id
    where i.quote_request_id = v_req.id
    for share of p, d;

  select * into v_primeiro
    from public.quote_request_itens
   where quote_request_id = v_req.id
   order by ordem
   limit 1;

  -- Colunas singulares de `jobs` seguem espelhando o primeiro ambiente.
  insert into public.jobs (
    quote_request_id,
    cliente_id, job_type, has_equipment, cep, endereco, cidade, descricao,
    produto_id, btu_recomendado, area_m2, ambiente, num_pessoas,
    insolacao_alta, andar_ou_telhado,
    profissional_id, status
  ) values (
    v_req.id,
    v_req.cliente_id, v_req.job_type,
    exists (select 1 from public.quote_request_itens i
             where i.quote_request_id = v_req.id and i.produto_id is not null),
    v_req.cep,
    btrim(p_endereco), v_req.cidade, v_req.descricao,
    coalesce(v_primeiro.produto_id, v_req.produto_id),
    coalesce(v_primeiro.btu_recomendado, v_req.btu_recomendado),
    coalesce(v_primeiro.area_m2,    nullif(v_detalhes->>'area_m2', '')::numeric),
    coalesce(v_primeiro.ambiente,   nullif(v_detalhes->>'ambiente', '')),
    coalesce(v_primeiro.num_pessoas, nullif(v_detalhes->>'num_pessoas', '')::int),
    coalesce(v_primeiro.insolacao_alta,   nullif(v_detalhes->>'insolacao_alta', '')::boolean),
    coalesce(v_primeiro.andar_ou_telhado, nullif(v_detalhes->>'andar_ou_telhado', '')::boolean),
    v_quote.professional_id, 'aguardando_profissional'
  )
  returning id into v_job_id;

  insert into public.job_itens (
    job_id, ordem, ambiente, area_m2, num_pessoas, eletronicos,
    insolacao_alta, andar_ou_telhado, btu_recomendado, produto_id, quantidade,
    preco_venda_snapshot, custo_snapshot, distributor_id
  )
  select
    v_job_id, i.ordem, i.ambiente, i.area_m2, i.num_pessoas, i.eletronicos,
    i.insolacao_alta, i.andar_ou_telhado, i.btu_recomendado, i.produto_id, i.quantidade,
    coalesce(p.preco_venda, 0) * i.quantidade,
    coalesce(p.custo, 0)       * i.quantidade,
    p.distributor_id
    from public.quote_request_itens i
    left join public.products p on p.id = i.produto_id
   where i.quote_request_id = v_req.id
   order by i.ordem;

  select coalesce(sum(preco_venda_snapshot), 0), coalesce(sum(custo_snapshot), 0)
    into v_venda, v_custo
    from public.job_itens
   where job_id = v_job_id;

  select pc.comissao_servico_pct into v_pct
    from public.platform_config pc
   where pc.id;

  insert into public.orders (
    job_id, preco_produto, preco_servico, comissao_servico, margem_produto, total, payment_status
  ) values (
    v_job_id,
    v_venda,
    v_servico,
    round(v_servico * coalesce(v_pct, 0.15), 2),
    v_venda - v_custo,
    v_venda + v_servico,
    'pendente'
  )
  returning id into v_order_id;

  -- Uma ordem de compra por distribuidora envolvida, com o custo somado dos
  -- itens dela e o maior prazo entre eles.
  insert into public.purchase_orders (
    order_id, distributor_id, custo_snapshot, prazo_previsto
  )
  select
    v_order_id,
    ji.distributor_id,
    sum(ji.custo_snapshot),
    current_date + coalesce(max(d.prazo_entrega_dias), 5)
    from public.job_itens ji
    join public.distributors d on d.id = ji.distributor_id
   where ji.job_id = v_job_id
     and ji.distributor_id is not null
   group by ji.distributor_id;

  update public.quotes
     set status = 'aceita', job_id = v_job_id
   where id = p_quote_id;

  update public.quotes
     set status = 'recusada'
   where quote_request_id = v_req.id
     and id <> p_quote_id
     and status = 'enviada';

  update public.quote_requests
     set status = 'fechado', detalhes = v_detalhes
   where id = v_req.id;

  return v_job_id;
end;
$$;

revoke all on function public.aceitar_quote(uuid, text, jsonb) from public, anon;
grant execute on function public.aceitar_quote(uuid, text, jsonb) to authenticated;

comment on function public.aceitar_quote(uuid, text, jsonb) is
  'Aceite serializado por quote_request. Congela o escopo em job_itens, soma produto e margem na order e abre uma purchase_order por distribuidora.';
