-- ============================================================================
-- `entregas_cliente` ganha itens e histórico
--
-- Hoje a tela `/servico/[id]` mostra a entrega do aparelho misturada com o
-- valor do serviço, e só com status/rastreio/previsão — sem os itens nem
-- datas de cada transição. Isso nasce de uma tela própria (linha do tempo do
-- aparelho) que precisa: (1) listar os aparelhos daquela entrega específica,
-- (2) mostrar quando cada etapa aconteceu.
--
-- (1) não dava pra fazer no frontend sem reabrir leitura de `job_itens`
-- inteira (que está sendo fechada na próxima migration, por vazar
-- custo_snapshot). (2) é impossível no frontend de qualquer jeito: a RLS de
-- `purchase_order_events` só libera distribuidora e admin — o cliente nunca
-- leu essa tabela.
--
-- Por isso os dois entram agregados na própria view, do mesmo jeito que ela
-- já faz com `distribuidora` (nome, não FK crua). `security_invoker = off`
-- continua sendo o desenho: a view roda como dona, e o filtro por auth.uid()
-- no final é a ÚNICA barreira — não alterar sem entender essa consequência.
-- ============================================================================
drop view if exists public.entregas_cliente;
create view public.entregas_cliente with (security_invoker = off) as
  select
    po.id,
    po.order_id,
    o.job_id,
    po.status,
    po.codigo_rastreio,
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
 where j.cliente_id = auth.uid() or j.profissional_id = auth.uid();

comment on view public.entregas_cliente is
  'Andamento da entrega para cliente e profissional do job, com os itens daquela distribuidora (sem custo_snapshot) e o histórico de transições. Autorização vem do filtro por auth.uid() — view roda como dona (security_invoker off), não alterar sem entender essa consequência.';

revoke all on public.entregas_cliente from anon;
grant select on public.entregas_cliente to authenticated;
