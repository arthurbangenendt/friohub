-- ============================================================================
-- Link de rastreio real + linha do tempo também para a distribuidora
--
-- Hoje "rastreio" é só um `codigo_rastreio` texto livre — nunca virou link
-- (nem pro cliente, nem pra distribuidora ver de volta), porque não há
-- transportadora nem URL salvos. A distribuidora cola o link de rastreio da
-- própria transportadora (Correios, Jadlog etc.) ao marcar como enviado —
-- mais simples e mais robusto que manter um mapa de URL por transportadora
-- no código, que quebra sempre que uma delas muda o formato.
--
-- Também estende `pedidos_distribuidora` com `eventos`, no mesmo padrão já
-- usado em `entregas_cliente` (20260818100000): a distribuidora só via uma
-- badge de status na própria tela, sem histórico de quando confirmou/faturou.
-- ============================================================================

alter table public.purchase_orders
  add column if not exists link_rastreio text;

alter table public.purchase_orders
  add constraint purchase_orders_link_rastreio_formato
  check (link_rastreio is null or link_rastreio ~* '^https?://');

-- ---------------------------------------------------------------------------
-- 1. `avancar_purchase_order` passa a receber e exigir p_link_rastreio (em vez
--    de p_codigo_rastreio) para marcar como "enviado". codigo_rastreio
--    continua existindo e sendo aceito, mas vira opcional — só a URL é
--    obrigatória, é o que vira link de verdade nas duas telas.
-- ---------------------------------------------------------------------------
drop function if exists public.avancar_purchase_order(uuid, text, text, text);

create or replace function public.avancar_purchase_order(
  p_purchase_order_id uuid,
  p_status text,
  p_codigo_rastreio text default null,
  p_nota_fiscal_url text default null,
  p_link_rastreio text default null
)
returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_po        public.purchase_orders%rowtype;
  v_resultado public.purchase_orders%rowtype;
  v_ok        boolean := false;
  v_rastreio  text;
  v_link      text := nullif(btrim(coalesce(p_link_rastreio, '')), '');
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;

  select * into v_po
    from public.purchase_orders
   where id = p_purchase_order_id
   for update;

  if not found then
    raise exception 'Pedido de repasse não encontrado.';
  end if;
  if v_po.distributor_id is distinct from v_uid and not public.eh_admin() then
    raise exception 'Você não pode movimentar este repasse.';
  end if;

  v_ok := case v_po.status
    when 'a_repassar' then p_status in ('confirmado', 'cancelado')
    when 'confirmado' then p_status in ('faturado', 'cancelado')
    when 'faturado'   then p_status in ('enviado', 'cancelado')
    when 'enviado'    then p_status = 'entregue'
    else false
  end;

  if not v_ok then
    raise exception 'Transição de repasse inválida: % → %.', v_po.status, p_status;
  end if;

  if v_link is not null and v_link !~* '^https?://' then
    raise exception 'Link de rastreio inválido — cole a URL completa (começando com http:// ou https://).';
  end if;

  v_rastreio := coalesce(nullif(btrim(p_codigo_rastreio), ''), v_po.codigo_rastreio);
  v_link     := coalesce(v_link, v_po.link_rastreio);
  if p_status = 'enviado' and v_link is null then
    raise exception 'Cole o link de rastreio antes de marcar como enviado.';
  end if;

  update public.purchase_orders
     set status = p_status,
         codigo_rastreio = v_rastreio,
         link_rastreio = v_link,
         nota_fiscal_url = coalesce(
           nullif(btrim(p_nota_fiscal_url), ''),
           v_po.nota_fiscal_url
         )
   where id = v_po.id
  returning * into v_resultado;

  insert into public.purchase_order_events (
    purchase_order_id, actor_id, status_anterior, status_novo, metadata
  ) values (
    v_po.id,
    v_uid,
    v_po.status,
    p_status,
    jsonb_strip_nulls(jsonb_build_object(
      'codigo_rastreio', v_rastreio,
      'link_rastreio', v_link,
      'nota_fiscal_url', nullif(btrim(p_nota_fiscal_url), '')
    ))
  );

  return v_resultado;
end;
$$;

revoke all on function public.avancar_purchase_order(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.avancar_purchase_order(uuid, text, text, text, text)
  to authenticated;

comment on function public.avancar_purchase_order is
  'Avança o repasse pela máquina de estados (a_repassar→confirmado→faturado→enviado→entregue, +cancelado), gravando o histórico em purchase_order_events. Exige link_rastreio (URL completa) para marcar como enviado — vira link clicável nas duas pontas, não um código solto.';

-- ---------------------------------------------------------------------------
-- 2. `pedidos_distribuidora` ganha link_rastreio e eventos (histórico), mesmo
--    padrão de `entregas_cliente`.
-- ---------------------------------------------------------------------------
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
               'custo_snapshot', ji.custo_snapshot
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
  'Pedidos de repasse da própria distribuidora, com endereço de despacho, itens (com custo_snapshot, que é o dinheiro dela) e histórico de transições. Autorização vem do filtro por auth.uid() — view roda como dona (security_invoker off), não alterar sem entender essa consequência.';

revoke all on public.pedidos_distribuidora from anon;
grant select on public.pedidos_distribuidora to authenticated;

-- ---------------------------------------------------------------------------
-- 3. `entregas_cliente` ganha link_rastreio.
-- ---------------------------------------------------------------------------
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
 where j.cliente_id = auth.uid() or j.profissional_id = auth.uid();

comment on view public.entregas_cliente is
  'Andamento da entrega para cliente e profissional do job, com os itens daquela distribuidora (sem custo_snapshot), link de rastreio e histórico de transições. Autorização vem do filtro por auth.uid() — view roda como dona (security_invoker off), não alterar sem entender essa consequência.';

revoke all on public.entregas_cliente from anon;
grant select on public.entregas_cliente to authenticated;
