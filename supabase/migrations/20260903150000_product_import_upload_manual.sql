-- ============================================================================
-- Upload manual de planilha — cobre a distribuidora que não tem ERP/API
--
-- A integração via API (20260903100000 em diante) resolve quem já tem
-- sistema próprio. Quem controla o estoque numa planilha, ou não tem sistema
-- nenhum, ficava sem alternativa ao cadastro produto a produto. Esta
-- migration reabre `ingerir_lote_produtos` para chamada AUTENTICADA (sessão
-- normal do painel, não API key) — a distribuidora sobe um CSV, ele entra no
-- MESMO staging/validação/preview/aplicação que o caminho de API já usa.
--
-- Autorização dupla, mesmo padrão de `aplicar_lote_importacao`/
-- `rejeitar_lote_importacao` (20260903140000): sessão de usuário só importa
-- em nome de si mesma (ou admin); sem sessão, só service_role (a Edge
-- Function, que já validou a API key antes de chamar).
-- ============================================================================

create or replace function public.ingerir_lote_produtos(
  p_distributor_id uuid,
  p_idempotency_key text,
  p_itens jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_existing uuid;
  v_count    integer;
  v_item     jsonb;
  v_line     integer := 0;
  v_sku      text;
begin
  if p_distributor_id is null then
    raise exception 'Distribuidora não identificada.';
  end if;

  if auth.uid() is not null then
    if auth.uid() <> p_distributor_id and not public.eh_admin() then
      raise exception 'Você não tem acesso para importar em nome desta distribuidora.';
    end if;
  elsif current_user <> 'service_role' then
    raise exception 'Não autorizado.';
  end if;

  v_count := jsonb_array_length(coalesce(p_itens, '[]'::jsonb));
  if v_count = 0 then
    raise exception 'Lote vazio.';
  end if;
  if v_count > 2000 then
    raise exception 'Lote acima do limite de 2000 itens — pagine em mais de uma chamada.';
  end if;

  -- Rate limit ANTES de gravar qualquer coisa — reusa consume_rate_limit
  -- (20260813184012_resilience_phase5.sql), mesma função já usada em
  -- quote_requests/messages/pmoc_plans. Vale igual pro upload manual: evita
  -- que alguém martele o botão de importar.
  perform public.consume_rate_limit('product_import_batch_hour', p_distributor_id, 20, 3600);
  perform public.consume_rate_limit('product_import_batch_day', p_distributor_id, 100, 86400);
  perform public.consume_rate_limit('product_import_items_day', p_distributor_id, 20000, 86400);

  if nullif(btrim(p_idempotency_key), '') is not null then
    select id into v_existing from public.product_import_batches
     where distributor_id = p_distributor_id and idempotency_key = btrim(p_idempotency_key);
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  insert into public.product_import_batches (distributor_id, idempotency_key, total_items)
  values (p_distributor_id, nullif(btrim(p_idempotency_key), ''), v_count)
  returning id into v_batch_id;

  for v_item in select jsonb_array_elements(p_itens) loop
    v_line := v_line + 1;
    v_sku := nullif(btrim(v_item->>'sku_distribuidor'), '');
    if v_sku is null then
      raise exception 'Item na linha % sem código do produto.', v_line;
    end if;

    insert into public.product_import_items (batch_id, line_number, sku_distribuidor, raw, image_url_original)
    values (v_batch_id, v_line, v_sku, v_item, nullif(btrim(v_item->>'image_url'), ''));
  end loop;

  return v_batch_id;
exception
  when unique_violation then
    raise exception 'Código de produto duplicado dentro do mesmo lote.';
end;
$$;

revoke all on function public.ingerir_lote_produtos(uuid, text, jsonb) from public, anon;
grant execute on function public.ingerir_lote_produtos(uuid, text, jsonb) to authenticated, service_role;

comment on function public.ingerir_lote_produtos(uuid, text, jsonb) is
  'Grava o lote cru em transação (staged) e devolve o batch_id. Chamável por service_role (Edge Function, API key já validada) OU por uma distribuidora autenticada importando em nome de si mesma (upload manual de planilha no painel). Levanta exceção — e portanto NÃO cria o batch — em payload vazio, acima de 2000 itens, código repetido no mesmo payload, ou rate limit estourado.';
