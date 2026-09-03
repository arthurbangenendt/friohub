-- ============================================================================
-- Staging da importação em massa — nada entra em `products` sem passar por
-- aqui primeiro.
--
-- Modelo: a Edge Function de ingestão grava o lote cru (`staged`), o worker
-- periódico valida item a item (`ready_for_review`), a distribuidora revisa
-- no painel e confirma (`applied`) ou descarta (`rejected`). Ver
-- 20260903130000 (validação) e 20260903140000 (aplicação).
--
-- RECURSÃO — mesma lição de 20260812250000: `product_import_items` não pode
-- checar o dono do lote com uma subquery direta em `product_import_batches`
-- (RLS lendo RLS). `dono_do_lote_importacao` resolve isso por SECURITY
-- DEFINER, como `distribuidora_ativa`/`cliente_da_purchase_order`.
-- ============================================================================

create table public.product_import_batches (
  id              uuid primary key default gen_random_uuid(),
  distributor_id  uuid not null references public.distributors (id) on delete cascade,
  api_key_id      uuid references public.distributor_api_keys (id) on delete set null,

  status          text not null default 'staged'
                  check (status in ('staged', 'validating', 'ready_for_review', 'applying', 'applied', 'rejected', 'expired')),

  idempotency_key text,
  total_items     integer not null default 0,
  valid_items     integer not null default 0,
  error_items     integer not null default 0,

  criado_em       timestamptz not null default now(),
  validado_em     timestamptz,
  confirmado_em   timestamptz,
  confirmado_por  uuid references public.profiles (id),
  expira_em       timestamptz not null default now() + interval '7 days'
);

comment on table public.product_import_batches is
  'Um lote = uma chamada de sync do ERP da distribuidora. Nada em products muda até o status virar applied, via aplicar_lote_importacao.';
comment on column public.product_import_batches.idempotency_key is
  'Chave que o ERP manda pra reenvio de rede não duplicar o lote — ver ingerir_lote_produtos.';

-- Reenvio do mesmo idempotency_key (retry do ERP) devolve o batch já criado
-- em vez de duplicar — índice parcial pra não colidir quando o ERP não manda
-- chave nenhuma.
create unique index uq_import_batches_idempotency
  on public.product_import_batches (distributor_id, idempotency_key)
  where idempotency_key is not null;

create index idx_import_batches_dist on public.product_import_batches (distributor_id, criado_em desc);
create index idx_import_batches_status on public.product_import_batches (status)
  where status in ('staged', 'validating');

create table public.product_import_items (
  id                  uuid primary key default gen_random_uuid(),
  batch_id            uuid not null references public.product_import_batches (id) on delete cascade,
  line_number         integer not null,
  sku_distribuidor    text not null,
  raw                 jsonb not null,

  action              text check (action in ('insert', 'update')),
  matched_product_id  uuid references public.products (id),
  status              text not null default 'pending' check (status in ('pending', 'valid', 'error')),
  errors              jsonb not null default '[]'::jsonb,

  image_url_original  text,
  image_status        text not null default 'pending' check (image_status in ('pending', 'fetched', 'failed', 'skipped')),
  image_final_url     text,

  claimed_at          timestamptz
);

comment on table public.product_import_items is
  'Um item = uma linha do payload do ERP. SKU duplicado dentro do MESMO lote já falha na ingestão (uq_import_items_batch_sku) — o resto da validação de negócio é feita pelo worker, ver validar_item_importacao.';

create unique index uq_import_items_batch_sku on public.product_import_items (batch_id, sku_distribuidor);
create index idx_import_items_pending on public.product_import_items (batch_id) where status = 'pending';

alter table public.product_import_batches enable row level security;
alter table public.product_import_items   enable row level security;

create or replace function public.dono_do_lote_importacao(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.product_import_batches b
     where b.id = p_batch_id and (b.distributor_id = auth.uid() or public.eh_admin())
  );
$$;

create policy "import_batches_dist_read" on public.product_import_batches
  for select using (distributor_id = auth.uid() or public.eh_admin());

create policy "import_items_dist_read" on public.product_import_items
  for select using (public.dono_do_lote_importacao(batch_id));

/* Nenhuma policy de insert/update/delete pra anon/authenticated: a ingestão é
   sempre via service_role (Edge Function autenticada por API key), e a
   validação/aplicação são RPCs SECURITY DEFINER (20260903130000,
   20260903140000). A distribuidora só LÊ o próprio lote — a porta de escrita
   direta fica fechada de propósito. */
revoke all on public.product_import_batches, public.product_import_items from anon, authenticated;
grant select on public.product_import_batches, public.product_import_items to authenticated;

-- ---------------------------------------------------------------------------
-- Ingestão — chamada pela Edge Function `product-import-ingest`, já com a
-- distribuidora resolvida por `validar_chave_api`. Grava cru e responde
-- rápido (mesmo espírito do `asaas-webhook`); a validação de campo fica pro
-- worker periódico.
-- ---------------------------------------------------------------------------
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

  v_count := jsonb_array_length(coalesce(p_itens, '[]'::jsonb));
  if v_count = 0 then
    raise exception 'Lote vazio.';
  end if;
  if v_count > 2000 then
    raise exception 'Lote acima do limite de 2000 itens — pagine em mais de uma chamada.';
  end if;

  -- Rate limit ANTES de gravar qualquer coisa — reusa consume_rate_limit
  -- (20260813184012_resilience_phase5.sql), mesma função já usada em
  -- quote_requests/messages/pmoc_plans.
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
      raise exception 'Item na linha % sem sku_distribuidor.', v_line;
    end if;

    insert into public.product_import_items (batch_id, line_number, sku_distribuidor, raw, image_url_original)
    values (v_batch_id, v_line, v_sku, v_item, nullif(btrim(v_item->>'image_url'), ''));
  end loop;

  return v_batch_id;
exception
  when unique_violation then
    raise exception 'sku_distribuidor duplicado dentro do mesmo lote.';
end;
$$;

revoke all on function public.ingerir_lote_produtos(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.ingerir_lote_produtos(uuid, text, jsonb) to service_role;

comment on function public.ingerir_lote_produtos(uuid, text, jsonb) is
  'Grava o lote cru em transação (staged) e devolve o batch_id. Levanta exceção — e portanto NÃO cria o batch — em payload vazio, acima de 2000 itens, SKU repetido no mesmo payload, ou rate limit estourado. A Edge Function traduz cada uma dessas exceções pro código HTTP correspondente (422/429).';
