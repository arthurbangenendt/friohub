-- ============================================================================
-- `orders_cliente` precisa distinguir visita de serviço
--
-- A view (20260812130000_orders_cliente_view) projeta colunas explicitamente —
-- não propaga `origem` sozinha. Sem ela, o cliente não consegue separar a
-- order da visita da order do orçamento final na tela do serviço.
-- ============================================================================
drop view if exists public.orders_cliente;
create view public.orders_cliente
with (security_invoker = off) as
  select o.id, o.job_id, o.preco_produto, o.preco_servico, o.total,
         o.payment_status, o.origem, o.created_at
    from public.orders o
    join public.jobs j on j.id = o.job_id
   where j.cliente_id = auth.uid();

comment on view public.orders_cliente is
  'Visão do cliente sobre as próprias orders do job (visita e/ou serviço), sem margem nem comissão da plataforma. Autorização vem do filtro por auth.uid().';

revoke all on public.orders_cliente from anon;
grant select on public.orders_cliente to authenticated;
