-- ============================================================================
-- Foto do aparelho em `pedidos_distribuidora`
-- ============================================================================
--
-- Mesma mudança de 20260826090000, na view irmã que a distribuidora usa pra
-- despachar (`pedidos_distribuidora` é escopada por `distributor_id =
-- auth.uid()`, diferente de `entregas_cliente`, mas os dois vieram do mesmo
-- corpo de query e merecem o mesmo campo). Corpo idêntico ao de
-- 20260818130000_link_rastreio_e_timeline_distribuidora.sql, só ganha
-- `p.image_url` no jsonb de cada item.

drop view if exists public.pedidos_distribuidora;
create view public.pedidos_distribuidora with (security_invoker = off) as
  select
    po.id,
    po.status,
    po.custo_snapshot,
    po.codigo_rastreio,
    po.link_rastreio,
    po.nota_fiscal_url,
    po.prazo_previsto,
    po.created_at,
    j.id as job_id,
    j.cep,
    j.endereco,
    j.cidade,
    cli.nome as cliente_nome,
    coalesce(itens.itens, '[]'::jsonb) as itens,
    coalesce(eventos.eventos, '[]'::jsonb) as eventos
  from public.purchase_orders po
  join public.orders o on o.id = po.order_id
  join public.jobs   j on j.id = o.job_id
  join public.profiles cli on cli.id = j.cliente_id
  left join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'ambiente', ji.ambiente,
               'quantidade', ji.quantidade,
               'marca', p.marca,
               'modelo', p.modelo,
               'btu', p.btu,
               'preco_venda_snapshot', ji.preco_venda_snapshot,
               'custo_snapshot', ji.custo_snapshot,
               'image_url', p.image_url
             )
             order by ji.ordem
           ) as itens
      from public.job_itens ji
      left join public.products p on p.id = ji.produto_id
     where ji.job_id = j.id and ji.distributor_id = po.distributor_id
  ) itens on true
  left join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'status_anterior', poe.status_anterior,
               'status_novo', poe.status_novo,
               'created_at', poe.created_at
             )
             order by poe.created_at asc
           ) as eventos
      from public.purchase_order_events poe
     where poe.purchase_order_id = po.id
  ) eventos on true
 where po.distributor_id = auth.uid();

comment on view public.pedidos_distribuidora is
  'Pedidos de repasse da própria distribuidora, com endereço de despacho, itens (com custo_snapshot, que é o dinheiro dela, e foto pública do produto) e histórico de transições. Autorização vem do filtro por auth.uid() — view roda como dona (security_invoker off), não alterar sem entender essa consequência.';

revoke all on public.pedidos_distribuidora from anon;
grant select on public.pedidos_distribuidora to authenticated;
