-- ============================================================================
-- Foto do aparelho em `entregas_cliente`
-- ============================================================================
--
-- Achado testando /admin/repasses: o item de entrega já trazia marca/modelo/
-- btu, mas nenhuma foto — `products.image_url` é coluna pública (mesma que já
-- aparece no catálogo da distribuidora e na vitrine), só nunca tinha sido
-- projetada nesta view. Beneficia as três telas que leem `entregas_cliente`
-- (cliente em /servico/[id]/aparelho, distribuidora em
-- /painel/distribuidora/pedidos, admin em /admin/repasses) com a mesma
-- mudança, em vez de duplicar a lógica de junção só pro admin.
--
-- Recriação de view de novo (mesma razão de 20260825094000): a projeção mora
-- no corpo da view, não dá pra "adicionar coluna" a uma view existente sem
-- redefini-la. Corpo idêntico a 20260825094000_entregas_cliente_admin.sql, só
-- ganha `p.image_url` no jsonb de cada item.

drop view if exists public.entregas_cliente;
create view public.entregas_cliente with (security_invoker = off) as
  select
    po.id,
    po.order_id,
    o.job_id,
    po.status,
    po.codigo_rastreio,
    po.link_rastreio,
    po.nota_fiscal_url,
    po.prazo_previsto,
    po.created_at,
    po.updated_at,
    po.distributor_id,
    d.razao_social as distribuidora,
    coalesce(itens.itens, '[]'::jsonb) as itens,
    coalesce(eventos.eventos, '[]'::jsonb) as eventos
  from public.purchase_orders po
  join public.orders o on o.id = po.order_id
  join public.jobs   j on j.id = o.job_id
  join public.distributors d on d.id = po.distributor_id
  left join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'ambiente', ji.ambiente,
               'quantidade', ji.quantidade,
               'marca', p.marca,
               'modelo', p.modelo,
               'btu', p.btu,
               'preco_venda_snapshot', ji.preco_venda_snapshot,
               'image_url', p.image_url
             )
             order by ji.ordem
           ) as itens
      from public.job_itens ji
      left join public.products p on p.id = ji.produto_id
     where ji.job_id = o.job_id and ji.distributor_id = po.distributor_id
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
 where j.cliente_id = auth.uid() or j.profissional_id = auth.uid() or public.eh_admin();

comment on view public.entregas_cliente is
  'Andamento da entrega para cliente, profissional e admin (suporte) do job, com os itens daquela distribuidora (sem custo_snapshot, com foto pública do produto), link de rastreio e histórico de transições. Autorização vem do filtro por auth.uid()/eh_admin() — view roda como dona (security_invoker off), não alterar sem entender essa consequência.';

revoke all on public.entregas_cliente from anon;
grant select on public.entregas_cliente to authenticated;
