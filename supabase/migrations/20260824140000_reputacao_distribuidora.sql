-- ============================================================================
-- Selo de reputação automático de distribuidora
-- ============================================================================
--
-- Sem tabela nova, sem avaliação por texto — `purchase_orders.prazo_previsto`
-- + a transição pra 'entregue' em `purchase_order_events` já dão o par
-- (prometido, entregue) por pedido. `security definer` porque a RLS de
-- `purchase_orders`/`purchase_order_events` só libera dono/admin — aqui só
-- sai o AGREGADO (contagem), nunca uma linha crua, então é seguro expor a
-- anon/authenticated.

create or replace function public.reputacao_distribuidora(p_distributor_id uuid)
returns table (total_entregues integer, no_prazo integer, taxa_no_prazo numeric, verificada boolean)
language sql
stable
security definer
set search_path = public
as $$
  with entregas as (
    select po.id, po.prazo_previsto, poe.entregue_em
      from public.purchase_orders po
      join lateral (
        select max(created_at) as entregue_em
          from public.purchase_order_events
         where purchase_order_id = po.id and status_novo = 'entregue'
      ) poe on poe.entregue_em is not null
     where po.distributor_id = p_distributor_id
  )
  select
    (select count(*)::integer from entregas),
    (select count(*) filter (where prazo_previsto is null or entregue_em::date <= prazo_previsto)::integer from entregas),
    (select case when count(*) > 0
      then round(100.0 * count(*) filter (where prazo_previsto is null or entregue_em::date <= prazo_previsto) / count(*), 0)
      else null
    end from entregas),
    (select verification_status = 'verificado' from public.distributors where id = p_distributor_id);
$$;

revoke all on function public.reputacao_distribuidora(uuid) from public;
grant execute on function public.reputacao_distribuidora(uuid) to anon, authenticated;

comment on function public.reputacao_distribuidora(uuid) is
  '% de pedidos entregues no prazo prometido. Só agregado — nunca expõe purchase_orders/purchase_order_events crus a quem não é dono/admin.';

-- ---------------------------------------------------------------------------
-- buscar_produtos_marketplace passa a devolver distributor_id — o frontend
-- precisa dele pra chamar reputacao_distribuidora por produto. Mudança
-- aditiva: mesmo filtro, mesma ordenação, só mais uma coluna no retorno.
--
-- Versão vigente é a de 5 parâmetros (com p_categoria, adicionada em
-- 20260819100000_pedido_aparelho_conhecido.sql — a exploração inicial achou
-- a de 4 parâmetros por engano, essa já tinha sido substituída). Mesmo
-- padrão daquela migration: `create or replace` não serve pra mudar retorno
-- de uma function existente — precisa dropar primeiro.
-- ---------------------------------------------------------------------------
drop function if exists public.buscar_produtos_marketplace(integer, text, integer, integer, text);

create function public.buscar_produtos_marketplace(
  p_btu integer default null,
  p_query text default null,
  p_limit integer default 12,
  p_offset integer default 0,
  p_categoria text default null
)
returns table (
  product_id uuid,
  marca text,
  modelo text,
  btu integer,
  categoria text,
  preco_venda numeric,
  image_url text,
  distribuidora text,
  distributor_id uuid,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id,
    p.marca,
    p.modelo,
    p.btu,
    p.categoria,
    p.preco_venda,
    p.image_url,
    d.razao_social,
    p.distributor_id,
    count(*) over ()
  from public.products p
  left join public.distributors d on d.id = p.distributor_id
  where p.ativo and p.estoque_disponivel
    and (p_categoria is null or p.categoria = p_categoria)
    and (
      nullif(btrim(coalesce(p_query, '')), '') is null
      or concat_ws(' ', p.marca, p.modelo, d.razao_social)
           ilike '%' || btrim(p_query) || '%'
    )
  order by
    case when p_btu is not null and p.btu = p_btu then 0 else 1 end,
    case when p_btu is not null then abs(p.btu - p_btu) else p.btu end,
    p.preco_venda,
    p.id
  limit least(24, greatest(1, coalesce(p_limit, 12)))
  offset least(10000, greatest(0, coalesce(p_offset, 0)));
$$;

revoke all on function public.buscar_produtos_marketplace(integer, text, integer, integer, text)
  from public;
grant execute on function public.buscar_produtos_marketplace(integer, text, integer, integer, text)
  to anon, authenticated;

comment on function public.buscar_produtos_marketplace(integer, text, integer, integer, text) is
  'Catálogo público paginado, sem custo da distribuidora, ordenado por compatibilidade de '
  'BTU e preço. p_categoria filtra por categoria. Devolve distributor_id para o selo de reputação.';
