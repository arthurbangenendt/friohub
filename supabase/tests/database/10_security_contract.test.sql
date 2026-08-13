begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);

select ok(
  has_column_privilege('anon', 'public.products', 'preco_venda', 'select'),
  'anon pode ler o preço público do produto'
);
select ok(
  not has_column_privilege('authenticated', 'public.products', 'custo', 'select'),
  'authenticated não pode ler o custo comercial do produto'
);
select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'orders' and cmd in ('INSERT', 'ALL')
  ),
  'orders não deve aceitar INSERT direto pela Data API'
);
select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'purchase_orders' and cmd in ('INSERT', 'ALL')
  ),
  'purchase_orders não deve aceitar INSERT direto pela Data API'
);

select ok(
  not exists (
    select 1
      from aclexplode(
        coalesce(
          (select proacl from pg_proc where oid = 'public.aceitar_quote(uuid,text,jsonb)'::regprocedure),
          acldefault(
            'f',
            (select proowner from pg_proc where oid = 'public.aceitar_quote(uuid,text,jsonb)'::regprocedure)
          )
        )
      ) acl
     where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC não pode executar aceitar_quote'
);
select ok(
  has_function_privilege('authenticated', 'public.aceitar_quote(uuid,text,jsonb)', 'execute'),
  'authenticated pode executar aceitar_quote'
);
select ok(
  not exists (
    select 1
      from aclexplode(
        coalesce(
          (select proacl from pg_proc where oid = 'public.revelar_contato(uuid)'::regprocedure),
          acldefault(
            'f',
            (select proowner from pg_proc where oid = 'public.revelar_contato(uuid)'::regprocedure)
          )
        )
      ) acl
     where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC não pode executar revelar_contato'
);
select ok(
  has_function_privilege('authenticated', 'public.revelar_contato(uuid)', 'execute'),
  'authenticated pode executar revelar_contato'
);

select is(
  (select prosecdef from pg_proc where oid = 'public.aceitar_quote(uuid,text,jsonb)'::regprocedure),
  true,
  'aceitar_quote deve continuar SECURITY DEFINER'
);
select ok(
  'search_path=public' = any(
    coalesce(
      (select proconfig from pg_proc where oid = 'public.aceitar_quote(uuid,text,jsonb)'::regprocedure),
      array[]::text[]
    )
  ),
  'aceitar_quote deve fixar search_path'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.revelar_contato(uuid)'::regprocedure),
  true,
  'revelar_contato deve continuar SECURITY DEFINER'
);
select ok(
  'search_path=public' = any(
    coalesce(
      (select proconfig from pg_proc where oid = 'public.revelar_contato(uuid)'::regprocedure),
      array[]::text[]
    )
  ),
  'revelar_contato deve fixar search_path'
);

select * from finish();
rollback;
