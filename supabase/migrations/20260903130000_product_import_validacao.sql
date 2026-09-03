-- ============================================================================
-- Validação da importação em massa
--
-- `validar_campos_produto` é NOVA — não é uma extração do trigger
-- `protege_produto` (20260828120000), que hoje só valida custo>0 e btu>0 no
-- banco (marca/modelo/categoria são validados em JS puro na server action
-- `salvarProduto`, do lado do formulário manual). Dado externo de ERP não
-- passa por aquele JS, então o lote em massa precisa da própria validação
-- completa (marca, modelo, btu, categoria, custo, quantidade) — deliberado
-- NÃO alterar `protege_produto` nesta migration: é um trigger que já protege
-- toda escrita em `products` em produção, e o único ganho de reescrevê-lo
-- pra chamar esta função seria eliminar uma pequena duplicação de regra
-- (custo>0/btu>0) às custas de mexer num caminho crítico já testado em
-- produção. Fica registrado como possível limpeza futura, não como parte
-- deste trabalho.
--
-- `reservar_itens_para_validar` segue o mesmo padrão de claim (`for update
-- skip locked` + timestamp de reserva) de `listar_repasses_prontos`
-- (20260828190000) e `listar_assinaturas_prontas_para_renovar`
-- (20260819190000) — evita duas execuções concorrentes do worker validarem o
-- mesmo item duas vezes.
-- ============================================================================

create or replace function public.validar_campos_produto(
  p_marca text,
  p_modelo text,
  p_btu integer,
  p_categoria text,
  p_custo numeric,
  p_estoque_quantidade integer
)
returns text[]
language plpgsql
stable
set search_path = public
as $$
declare
  v_erros text[] := array[]::text[];
begin
  if nullif(btrim(coalesce(p_marca, '')), '') is null or char_length(btrim(p_marca)) < 2 then
    v_erros := array_append(v_erros, 'Marca inválida — informe ao menos 2 caracteres.');
  end if;
  if nullif(btrim(coalesce(p_modelo, '')), '') is null or char_length(btrim(p_modelo)) < 3 then
    v_erros := array_append(v_erros, 'Modelo inválido — informe ao menos 3 caracteres.');
  end if;
  if p_btu is null or p_btu <= 0 then
    v_erros := array_append(v_erros, 'Capacidade (BTU) precisa ser maior que zero.');
  end if;
  if p_categoria is null or p_categoria not in ('split', 'inverter', 'multi_split', 'piso_teto', 'janela') then
    v_erros := array_append(v_erros, 'Categoria inválida — use split, inverter, multi_split, piso_teto ou janela.');
  end if;
  if p_custo is null or p_custo <= 0 then
    v_erros := array_append(v_erros, 'Custo precisa ser maior que zero.');
  end if;
  if p_estoque_quantidade is not null and p_estoque_quantidade < 0 then
    v_erros := array_append(v_erros, 'Quantidade em estoque não pode ser negativa.');
  end if;
  return v_erros;
end;
$$;

comment on function public.validar_campos_produto(text, text, integer, text, numeric, integer) is
  'Fonte única de validação de campo pra importação em lote. Array vazio = sem erro. NÃO é chamada pelo trigger protege_produto — ver nota no topo da migration.';

-- ---------------------------------------------------------------------------
-- Reserva de itens pendentes — chamada pelo worker a cada execução.
-- ---------------------------------------------------------------------------
create or replace function public.reservar_itens_para_validar(p_limit integer default 100)
returns setof public.product_import_items
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.product_import_items
     set claimed_at = now()
   where id in (
     select id from public.product_import_items
      where status = 'pending'
        and (claimed_at is null or claimed_at < now() - interval '10 minutes')
      order by batch_id, line_number
      limit least(greatest(coalesce(p_limit, 100), 1), 500)
      for update skip locked
   )
  returning *;
end;
$$;

revoke all on function public.reservar_itens_para_validar(integer) from public, anon, authenticated;
grant execute on function public.reservar_itens_para_validar(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Valida um item: casa por SKU (insert vs update) e roda
-- validar_campos_produto. Campo numérico que não parseia vira erro do item,
-- não exceção do worker — um payload malformado de um ERP não pode travar a
-- fila inteira.
-- ---------------------------------------------------------------------------
create or replace function public.validar_item_importacao(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item      public.product_import_items%rowtype;
  v_batch     public.product_import_batches%rowtype;
  v_marca     text;
  v_modelo    text;
  v_btu       integer;
  v_categoria text;
  v_custo     numeric;
  v_estoque   integer;
  v_parse_ok  boolean := true;
  v_erros     text[];
  v_matched   uuid;
begin
  select * into v_item from public.product_import_items where id = p_item_id;
  if not found then return; end if;
  select * into v_batch from public.product_import_batches where id = v_item.batch_id;

  v_marca     := v_item.raw->>'marca';
  v_modelo    := v_item.raw->>'modelo';
  v_categoria := v_item.raw->>'categoria';

  begin
    v_btu     := nullif(v_item.raw->>'btu', '')::integer;
    v_custo   := nullif(v_item.raw->>'custo', '')::numeric;
    v_estoque := nullif(v_item.raw->>'estoque_quantidade', '')::integer;
  exception when others then
    v_parse_ok := false;
  end;

  if not v_parse_ok then
    v_erros := array['Campos btu, custo ou estoque_quantidade não são números válidos.'];
  else
    v_erros := public.validar_campos_produto(v_marca, v_modelo, v_btu, v_categoria, v_custo, v_estoque);
  end if;

  select p.id into v_matched from public.products p
   where p.distributor_id = v_batch.distributor_id and p.sku_distribuidor = v_item.sku_distribuidor;

  update public.product_import_items
     set status = case when array_length(v_erros, 1) is null then 'valid' else 'error' end,
         errors = to_jsonb(v_erros),
         action = case when v_matched is null then 'insert' else 'update' end,
         matched_product_id = v_matched,
         claimed_at = null
   where id = p_item_id;
end;
$$;

revoke all on function public.validar_item_importacao(uuid) from public, anon, authenticated;
grant execute on function public.validar_item_importacao(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Registra o resultado do fetch de imagem (feito em Deno na Edge Function —
-- Postgres não faz HTTP fetch de conteúdo binário de forma prática aqui).
-- ---------------------------------------------------------------------------
create or replace function public.registrar_imagem_importada(p_item_id uuid, p_url text, p_erro text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.product_import_items
     set image_status = case when p_erro is not null then 'failed'
                              when p_url is not null then 'fetched'
                              else 'skipped' end,
         image_final_url = p_url
   where id = p_item_id;
end;
$$;

revoke all on function public.registrar_imagem_importada(uuid, text, text) from public, anon, authenticated;
grant execute on function public.registrar_imagem_importada(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Fecha a validação do lote quando não sobra item pendente.
-- ---------------------------------------------------------------------------
create or replace function public.fechar_validacao_lote(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending integer;
  v_valid   integer;
  v_error   integer;
begin
  select count(*) filter (where status = 'pending'),
         count(*) filter (where status = 'valid'),
         count(*) filter (where status = 'error')
    into v_pending, v_valid, v_error
    from public.product_import_items where batch_id = p_batch_id;

  if v_pending > 0 then
    return;
  end if;

  update public.product_import_batches
     set status = 'ready_for_review', valid_items = v_valid, error_items = v_error, validado_em = now()
   where id = p_batch_id and status in ('staged', 'validating');
end;
$$;

revoke all on function public.fechar_validacao_lote(uuid) from public, anon, authenticated;
grant execute on function public.fechar_validacao_lote(uuid) to service_role;
