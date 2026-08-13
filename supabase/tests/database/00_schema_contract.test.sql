begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(20);

select has_table('public', 'profiles', 'profiles deve existir');
select has_table('public', 'professionals', 'professionals deve existir');
select has_table('public', 'distributors', 'distributors deve existir');
select has_table('public', 'products', 'products deve existir');
select has_table('public', 'quote_requests', 'quote_requests deve existir');
select has_table('public', 'quotes', 'quotes deve existir');
select has_table('public', 'jobs', 'jobs deve existir');
select has_table('public', 'orders', 'orders deve existir');
select has_table('public', 'purchase_orders', 'purchase_orders deve existir');
select has_table('public', 'conversations', 'conversations deve existir');
select has_table('public', 'messages', 'messages deve existir');

select has_function(
  'public',
  'aceitar_quote',
  array['uuid', 'text', 'jsonb'],
  'aceitar_quote(uuid, text, jsonb) deve existir'
);
select has_function('public', 'revelar_contato', array['uuid'], 'revelar_contato(uuid) deve existir');
select has_function('public', 'marcar_conversa_lida', array['uuid'], 'marcar_conversa_lida(uuid) deve existir');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.products'::regclass),
  'products deve ter RLS habilitada'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.quote_requests'::regclass),
  'quote_requests deve ter RLS habilitada'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.purchase_orders'::regclass),
  'purchase_orders deve ter RLS habilitada'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.conversations'::regclass),
  'conversations deve ter RLS habilitada'
);

select ok(
  not has_table_privilege('anon', 'public.products', 'select'),
  'anon não deve possuir SELECT irrestrito na tabela products'
);
select ok(
  not has_column_privilege('anon', 'public.products', 'custo', 'select'),
  'anon não deve conseguir selecionar products.custo'
);

select * from finish();
rollback;
