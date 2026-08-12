-- ============================================================================
-- A margem da plataforma deixa de ser visível para o cliente.
--
-- A policy antiga liberava SELECT da linha inteira de `orders` para o cliente E
-- para o profissional. Como RLS é por LINHA (não por coluna), isso entregava
-- `margem_produto` e `comissao_servico` — o markup da FrioHub — para os dois
-- lados. A UI não mostrava, mas a API REST entregava.
--
-- Decisão do time: o profissional continua vendo tudo (precisa enxergar a
-- comissão que é descontada dele); o cliente passa a ver só o que paga.
--
-- Como RLS não filtra coluna, o cliente lê por uma VIEW com as colunas seguras.
-- ============================================================================

-- 1. `orders` passa a ser legível apenas pelo profissional do job.
drop policy if exists "orders_owner_read" on public.orders;
create policy "orders_prof_read" on public.orders for select
  using (exists (
    select 1 from public.jobs j
    where j.id = orders.job_id and j.profissional_id = auth.uid()
  ));

-- 2. View do cliente: sem `margem_produto`, sem `comissao_servico`.
--
-- Roda como dona (security_invoker desligado), portanto NÃO passa pela RLS de
-- `orders` — o filtro `j.cliente_id = auth.uid()` abaixo é o que autoriza. Ele
-- é a única barreira desta view: não altere sem entender essa consequência.
drop view if exists public.orders_cliente;
create view public.orders_cliente
with (security_invoker = off) as
  select o.id, o.job_id, o.preco_produto, o.preco_servico, o.total,
         o.payment_status, o.created_at
    from public.orders o
    join public.jobs j on j.id = o.job_id
   where j.cliente_id = auth.uid();

comment on view public.orders_cliente is
  'Visão do cliente sobre a própria order, sem margem nem comissão da plataforma. Autorização vem do filtro por auth.uid().';

-- Visitante anônimo não tem nada aqui; só quem está logado.
revoke all on public.orders_cliente from anon;
grant select on public.orders_cliente to authenticated;
