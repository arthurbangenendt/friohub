-- ============================================================================
-- Aplicação do lote de importação — o único lugar onde a importação em massa
-- de fato escreve em `products`.
--
-- RISCO DE SEGURANÇA REGISTRADO: `aplicar_lote_importacao` roda como
-- SECURITY DEFINER (dono do banco), então `current_user` dentro do trigger
-- `protege_produto` (20260828120000) NÃO é 'authenticated'/'anon' — o bloco
-- que auto-atribui distributor_id e trava troca de dono em UPDATE é PULADO
-- (só roda pra sessão de usuário comum). Isso significa que esta função é a
-- ÚNICA barreira contra:
--   1. gravar produto em nome de outra distribuidora — por isso o INSERT
--      abaixo usa SEMPRE v_batch.distributor_id, nunca um valor do payload;
--   2. um UPDATE "roubar" produto de outro dono — por isso o UPDATE confere
--      explicitamente que matched_product_id pertence a v_batch.distributor_id
--      antes de tocar nele.
-- custo>0/btu>0 continuam garantidos pelo trigger em qualquer current_user —
-- essa parte não precisa ser duplicada aqui.
--
-- preco_manual/preco_venda NUNCA são setados por esta função — ficam de fora
-- do INSERT/UPDATE de propósito, pra deixar o trigger `protege_produto`
-- derivar o preço do custo (ou preservar o preço fixo, se preco_manual já
-- era true). A distribuidora nunca escreve o preço final ao cliente, nem via
-- API.
-- ============================================================================

create or replace function public.aplicar_lote_importacao(p_batch_id uuid)
returns table(aplicados integer, ignorados integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch     public.product_import_batches%rowtype;
  v_item      record;
  v_aplicados integer := 0;
  v_ignorados integer := 0;
begin
  select * into v_batch from public.product_import_batches where id = p_batch_id for update;
  if not found then
    raise exception 'Lote não encontrado.';
  end if;

  -- Autorização dupla: sessão de usuário normal (painel) precisa ser a dona
  -- do lote (ou admin); sem sessão, só service_role pode chamar (reservado
  -- pra uma futura confirmação via API — não usado no v1, mas a trava já
  -- nasce correta).
  if auth.uid() is not null then
    if auth.uid() <> v_batch.distributor_id and not public.eh_admin() then
      raise exception 'Você não tem acesso a este lote.';
    end if;
  elsif current_user <> 'service_role' then
    raise exception 'Não autorizado.';
  end if;

  if v_batch.status <> 'ready_for_review' then
    raise exception 'Lote não está pronto para aplicação (status atual: %).', v_batch.status;
  end if;

  -- Trava o lote em 'applying' já dentro da transação: uma segunda chamada
  -- concorrente bloqueia no `for update` acima até esta terminar, e ao
  -- prosseguir encontra status <> 'ready_for_review' — não aplica em dobro.
  update public.product_import_batches set status = 'applying' where id = p_batch_id;

  for v_item in
    select * from public.product_import_items
     where batch_id = p_batch_id and status = 'valid'
     order by line_number
  loop
    if v_item.action = 'update' then
      if not exists (
        select 1 from public.products p
         where p.id = v_item.matched_product_id and p.distributor_id = v_batch.distributor_id
      ) then
        -- Produto mudou de dono ou foi apagado entre a validação e a
        -- aplicação — não confia no matched_product_id sem essa checagem.
        v_ignorados := v_ignorados + 1;
        continue;
      end if;

      update public.products
         set marca              = v_item.raw->>'marca',
             modelo             = v_item.raw->>'modelo',
             btu                = (v_item.raw->>'btu')::integer,
             categoria          = v_item.raw->>'categoria',
             custo              = (v_item.raw->>'custo')::numeric,
             estoque_quantidade = nullif(v_item.raw->>'estoque_quantidade', '')::integer,
             ativo              = coalesce((v_item.raw->>'ativo')::boolean, ativo),
             image_url          = coalesce(v_item.image_final_url, image_url),
             sku_distribuidor   = v_item.sku_distribuidor
       where id = v_item.matched_product_id;
    else
      insert into public.products (
        distributor_id, marca, modelo, btu, categoria, custo,
        estoque_quantidade, ativo, image_url, sku_distribuidor
      ) values (
        v_batch.distributor_id,
        v_item.raw->>'marca', v_item.raw->>'modelo',
        (v_item.raw->>'btu')::integer, v_item.raw->>'categoria', (v_item.raw->>'custo')::numeric,
        nullif(v_item.raw->>'estoque_quantidade', '')::integer,
        coalesce((v_item.raw->>'ativo')::boolean, true),
        v_item.image_final_url,
        v_item.sku_distribuidor
      );
    end if;
    v_aplicados := v_aplicados + 1;
  end loop;

  update public.product_import_batches
     set status = 'applied', confirmado_em = now(), confirmado_por = auth.uid()
   where id = p_batch_id;

  return query select v_aplicados, v_ignorados;
end;
$$;

revoke all on function public.aplicar_lote_importacao(uuid) from public, anon;
grant execute on function public.aplicar_lote_importacao(uuid) to authenticated, service_role;

comment on function public.aplicar_lote_importacao(uuid) is
  'Única função que escreve em products a partir de um lote de importação. Roda atômico: qualquer exceção no meio do loop reverte a transação inteira, inclusive o status applying — o lote volta pra ready_for_review como se nada tivesse rodado.';

-- ---------------------------------------------------------------------------
-- Rejeitar lote — descarta sem tocar em products. Mesma autorização de
-- aplicar_lote_importacao.
-- ---------------------------------------------------------------------------
create or replace function public.rejeitar_lote_importacao(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.product_import_batches%rowtype;
begin
  select * into v_batch from public.product_import_batches where id = p_batch_id for update;
  if not found then
    raise exception 'Lote não encontrado.';
  end if;

  if auth.uid() is not null then
    if auth.uid() <> v_batch.distributor_id and not public.eh_admin() then
      raise exception 'Você não tem acesso a este lote.';
    end if;
  elsif current_user <> 'service_role' then
    raise exception 'Não autorizado.';
  end if;

  if v_batch.status not in ('staged', 'validating', 'ready_for_review') then
    raise exception 'Lote não pode mais ser rejeitado (status atual: %).', v_batch.status;
  end if;

  update public.product_import_batches
     set status = 'rejected', confirmado_em = now(), confirmado_por = auth.uid()
   where id = p_batch_id;
end;
$$;

revoke all on function public.rejeitar_lote_importacao(uuid) from public, anon;
grant execute on function public.rejeitar_lote_importacao(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Expira lote parado em revisão — a distribuidora recebeu o preview e nunca
-- confirmou nem rejeitou. Cron diário, mesmo padrão de avaliar_saude_sistema.
-- ---------------------------------------------------------------------------
create or replace function public.expirar_lotes_importacao_pendentes()
returns void
language sql
security definer
set search_path = public
as $$
  update public.product_import_batches
     set status = 'expired'
   where status = 'ready_for_review'
     and expira_em < now();
$$;

revoke all on function public.expirar_lotes_importacao_pendentes() from public, anon, authenticated;

select cron.schedule(
  'friohub-import-lotes-expirar',
  '0 7 * * *',
  'select public.expirar_lotes_importacao_pendentes();'
);

-- ---------------------------------------------------------------------------
-- Dispara o worker de validação (Edge Function `product-import-processor`) a
-- cada minuto. Mesmo padrão vault + pg_net de
-- disparar_worker_renovacao_assinaturas (20260819190000): no-op silencioso
-- se os secrets ainda não estiverem configurados no Vault — não quebra o
-- deploy da migration, só fica inerte até alguém configurar
-- `product_import_worker_dispatch_url` e `product_import_worker_key`.
-- ---------------------------------------------------------------------------
create or replace function public.disparar_worker_importacao_produtos()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'product_import_worker_dispatch_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'product_import_worker_key';

  if v_url is null or v_key is null then
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object('origem', 'pg_cron'),
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    timeout_milliseconds := 15000
  );
end;
$$;

revoke all on function public.disparar_worker_importacao_produtos() from public, anon, authenticated;

select cron.schedule(
  'friohub-importacao-produtos-worker',
  '* * * * *',
  'select public.disparar_worker_importacao_produtos();'
);
