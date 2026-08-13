-- ============================================================================
-- Correção da migration anterior: `products.custo` continuava público.
--
-- 20260812220000 tentou esconder a coluna com
--
--   revoke select (custo) on public.products from anon, authenticated;
--
-- e isso não teve efeito nenhum. Privilégio de COLUNA no Postgres é ADITIVO
-- sobre o de TABELA: revogar a coluna não remove um `grant select` que existe
-- na tabela inteira — e o Supabase concede exatamente isso a `anon` e
-- `authenticated` por padrão. Verificado com a chave anônima depois de aplicar:
-- GET /rest/v1/products?select=custo seguia devolvendo o valor.
--
-- O caminho correto é revogar o SELECT da tabela e reconceder coluna a coluna,
-- deixando `custo` de fora. RLS (`products_read_all`) continua valendo por cima.
--
-- ATENÇÃO ao evoluir esta tabela: coluna nova nasce INVISÍVEL para o app até
-- receber grant explícito aqui. É o preço de ter allowlist em vez de blocklist —
-- e é o comportamento seguro, porque o default passa a ser "não expõe".
-- ============================================================================

revoke select on public.products from anon, authenticated;

grant select (
  id, marca, modelo, btu, categoria, preco_venda, supplier, image_url, ativo, created_at
) on public.products to anon, authenticated;

comment on column public.products.custo is
  'Custo na distribuidora. NUNCA legível por anon/authenticated — sem grant de coluna. Margem = preco_venda - custo, calculada no banco por criar_order().';
