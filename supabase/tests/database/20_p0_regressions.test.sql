begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

select is(
  (
    select count(*)::integer
      from pg_trigger
     where tgrelid = 'public.products'::regclass
       and not tgisinternal
       and tgname = 'trg_products_protege'
  ),
  1,
  'products usa um único trigger de proteção e cálculo'
);

select ok(
  not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.products'::regclass
       and not tgisinternal
       and tgname = 'trg_products_markup'
  ),
  'trigger de markup vulnerável foi removido'
);

select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'purchase_orders'
       and cmd in ('UPDATE', 'ALL')
  ),
  'purchase_orders não aceita update genérico pela Data API'
);

select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'avancar_purchase_order'
      and pg_get_function_identity_arguments(p.oid) = 'p_purchase_order_id uuid, p_status text, p_codigo_rastreio text, p_nota_fiscal_url text, p_link_rastreio text'
  ),
  'repasse possui RPC transacional explícita'
);

select has_table('public', 'purchase_order_events', 'transições de repasse possuem trilha de auditoria');

select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'conversations'
       and cmd in ('UPDATE', 'ALL')
  ),
  'conversations não aceita alteração direta dos participantes'
);

select ok(
  exists (
    select 1 from pg_trigger
     where tgrelid = 'public.quote_request_targets'::regclass
       and not tgisinternal
       and tgname = 'trg_quote_targets_protege_update'
  ),
  'destinatários congelam as chaves e limitam campos operacionais'
);

select ok(
  exists (
    select 1 from pg_trigger
     where tgrelid = 'public.quote_requests'::regclass
       and not tgisinternal
       and tgname = 'trg_quote_requests_protege'
  ),
  'pedido de orçamento congela identidade e escopo'
);

select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('quote_requests', 'quote_request_targets')
       and cmd = 'ALL'
  ),
  'orçamentos e destinatários não mantêm policy genérica ALL'
);

select is(
  (
    select count(*)::integer
      from pg_trigger
     where tgrelid in ('public.professionals'::regclass, 'public.distributors'::regclass)
       and not tgisinternal
       and tgname in ('trg_00_professionals_valida_papel', 'trg_00_distributors_valida_papel')
  ),
  2,
  'entidades de parceiro validam coerência com profiles.role'
);

select ok(
  exists (
    select 1 from pg_constraint
     where conrelid = 'public.jobs'::regclass
       and conname = 'jobs_quote_request_id_key'
       and contype = 'u'
  ),
  'um pedido de orçamento pode gerar no máximo um job'
);

select ok(
  coalesce((select not public from storage.buckets where id = 'orcamentos'), false),
  'bucket orcamentos deve ser privado'
);

select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname = 'orcamentos_public_read'
  ),
  'bucket de orçamentos não mantém leitura pública'
);

select ok(
  exists (
    select 1 from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname = 'orcamentos_participante_read'
       and cmd = 'SELECT'
  ),
  'somente participantes autenticados recebem leitura das fotos'
);

select has_column(
  'public', 'quote_request_photos', 'storage_path',
  'foto guarda caminho interno em vez de URL pública'
);

select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'criar_pedido_orcamento'
  ),
  'pedido, destinatários e fotos são criados atomicamente por RPC'
);

select * from finish();
rollback;
