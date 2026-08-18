-- ============================================================================
-- `job_itens.custo_snapshot` deixa de ser público
--
-- VAZAMENTO DE MARGEM encontrado ao investigar este pedido. `20260817122000`
-- deu `grant select on public.job_itens to authenticated` — tabela inteira.
-- Como a RLS de leitura libera cliente e profissional do job, qualquer um dos
-- dois consegue puxar `custo_snapshot` via REST
-- (`/rest/v1/job_itens?select=custo_snapshot&job_id=eq.X`) e calcular a
-- margem da plataforma item por item (`preco_venda_snapshot - custo_snapshot`).
--
-- É o mesmo furo que `20260812220100_products_custo_privado` já fechou em
-- `products.custo` — ficou de fora quando `job_itens` nasceu, porque o grant
-- de tabela é aditivo e atropela a intenção do comentário da própria coluna
-- ("preço e custo congelados no aceite da proposta").
--
-- Aplicar só DEPOIS das duas views anteriores: a distribuidora, que hoje lia
-- `custo_snapshot` só via este grant amplo (mesmo que sem conseguir juntar
-- com o endereço, por causa do bug de RLS corrigido em
-- 20260818101000_pedidos_distribuidora), passa a ler pela view, que roda como
-- dona. Único consumidor direto de `job_itens` no app hoje é
-- `src/app/servico/[id]/page.tsx`, e já pede só colunas desta allowlist.
-- ============================================================================
revoke select on public.job_itens from anon, authenticated;

grant select (
  id, job_id, ordem, ambiente, area_m2, num_pessoas, eletronicos,
  insolacao_alta, andar_ou_telhado, btu_recomendado, produto_id,
  quantidade, preco_venda_snapshot, distributor_id, created_at
) on public.job_itens to authenticated;

comment on column public.job_itens.custo_snapshot is
  'Custo da distribuidora, congelado no aceite. NUNCA legível por anon/authenticated — só via view pedidos_distribuidora (security_invoker off), que roda como dona.';
