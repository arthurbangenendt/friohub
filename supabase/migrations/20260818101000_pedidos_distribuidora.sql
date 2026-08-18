-- ============================================================================
-- `pedidos_distribuidora` — a distribuidora finalmente vê o endereço
--
-- BUG PRÉ-EXISTENTE encontrado ao investigar este pedido: a tela
-- `/painel/distribuidora/pedidos` (`purchase_orders → orders → jobs`) nunca
-- funcionou. `orders` só tem policy de leitura para o profissional
-- (`orders_prof_read`, 20260812130000) e `jobs` só para cliente/profissional
-- (20260811130000 / 20260812220000) — nenhuma das duas libera a
-- distribuidora. O embed sempre voltava null, e a tela caía nos fallbacks
-- "Aparelho" genérico e "endereço não informado". A distribuidora nunca
-- despachou vendo o endereço real por essa tela.
--
-- A correção NÃO é adicionar policy de distribuidora em `jobs`/`orders`: isso
-- abriria a linha inteira do job (descrição, histórico, tudo) para quem só
-- precisa do endereço de entrega. Mesma lógica de `orders_cliente`,
-- `entregas_cliente` e `meus_produtos` — view rodando como dona, projetando
-- só o necessário, com o filtro por auth.uid() como única barreira.
-- ============================================================================
drop view if exists public.pedidos_distribuidora;
create view public.pedidos_distribuidora with (security_invoker = off) as
  select
    po.id,
    po.status,
    po.custo_snapshot,
    po.codigo_rastreio,
    po.nota_fiscal_url,
    po.prazo_previsto,
    po.created_at,
    j.id as job_id,
    j.cep,
    j.endereco,
    j.cidade,
    cli.nome as cliente_nome,
    coalesce(itens.itens, '[]'::jsonb) as itens
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
               'custo_snapshot', ji.custo_snapshot
             )
             order by ji.ordem
           ) as itens
      from public.job_itens ji
      left join public.products p on p.id = ji.produto_id
     where ji.job_id = j.id and ji.distributor_id = po.distributor_id
  ) itens on true
 where po.distributor_id = auth.uid();

comment on view public.pedidos_distribuidora is
  'Pedidos de repasse da própria distribuidora, com endereço de despacho e itens (com custo_snapshot, que é o dinheiro dela). Autorização vem do filtro por auth.uid() — view roda como dona (security_invoker off), não alterar sem entender essa consequência.';

revoke all on public.pedidos_distribuidora from anon;
grant select on public.pedidos_distribuidora to authenticated;
