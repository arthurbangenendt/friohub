-- ============================================================================
-- SKU da distribuidora — chave de idempotência para o cadastro em massa
--
-- Prepara `products` para a importação em lote via API (migrations seguintes,
-- 20260903110000 em diante): cada distribuidora referencia o próprio produto
-- pelo SKU do ERP dela, e o sync casa por (distributor_id, sku_distribuidor)
-- para decidir insert vs update sem duplicar a cada sincronização.
--
-- Produto cadastrado manualmente no formulário continua sem SKU (nullable) —
-- ninguém é obrigado a migrar, e o índice único é parcial (só entre linhas com
-- SKU preenchido) para não colidir com o catálogo já existente.
-- ============================================================================

alter table public.products
  add column if not exists sku_distribuidor text;

comment on column public.products.sku_distribuidor is
  'Referência do produto no sistema da distribuidora (ERP). Só preenchido via importação em lote — cadastro manual fica null. Chave de idempotência do sync: ver product_import_items.';

create unique index if not exists uq_products_sku_distribuidor
  on public.products (distributor_id, sku_distribuidor)
  where sku_distribuidor is not null;

-- `create or replace view` só aceita coluna nova NO FIM da lista de colunas
-- (regra documentada em 20260828120000_estoque_quantidade.sql).
create or replace view public.meus_produtos with (security_invoker = off) as
  select p.id, p.marca, p.modelo, p.btu, p.categoria, p.preco_venda, p.custo,
         p.preco_manual, p.image_url, p.ativo, p.estoque_disponivel,
         p.distributor_id, p.created_at, p.estoque_quantidade, p.sku_distribuidor
    from public.products p
   where p.distributor_id = auth.uid();

-- `sku_distribuidor` não recebe grant de coluna pra anon/authenticated na
-- tabela base (mesmo motivo de `custo`: allowlist por coluna desde
-- 20260812220100). É referência interna do sync, não precisa vazar pra
-- vitrine pública — quem precisa enxergar (a própria distribuidora) já vê via
-- `meus_produtos`.
