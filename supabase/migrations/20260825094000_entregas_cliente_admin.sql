-- ============================================================================
-- Admin lê `entregas_cliente` para suporte
-- ============================================================================
--
-- Mesma classe de lacuna corrigida em 20260825093000 para `jobs`/`orders`:
-- `entregas_cliente` roda com `security_invoker = off` (view roda como dona,
-- não passa pela RLS de `purchase_orders`/`orders`/`jobs`) e filtra sozinha
-- por `j.cliente_id = auth.uid() or j.profissional_id = auth.uid()` — sem
-- cláusula de admin. Resultado prático: `/servico/[id]/aparelho` sempre
-- mostrava "sem aparelho comprado" para o admin, mesmo quando existia entrega,
-- porque a view devolvia zero linhas para ele.
--
-- Recriar a view inteira é necessário porque a autorização mora na cláusula
-- WHERE dela, não numa policy separada — não dá pra "adicionar" uma condição
-- a uma view existente sem redefini-la. Corpo idêntico ao de
-- 20260818130000_link_rastreio_e_timeline_distribuidora.sql, só a última
-- linha do WHERE ganha `or eh_admin()`.

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
               'preco_venda_snapshot', ji.preco_venda_snapshot
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
  'Andamento da entrega para cliente, profissional e admin (suporte) do job, com os itens daquela distribuidora (sem custo_snapshot), link de rastreio e histórico de transições. Autorização vem do filtro por auth.uid()/eh_admin() — view roda como dona (security_invoker off), não alterar sem entender essa consequência.';

revoke all on public.entregas_cliente from anon;
grant select on public.entregas_cliente to authenticated;
