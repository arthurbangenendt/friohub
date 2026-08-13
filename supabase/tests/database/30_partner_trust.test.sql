begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

select ok(
  not has_column_privilege('anon', 'public.distributors', 'cnpj', 'select'),
  'anônimo não lê CNPJ'
);

select ok(
  not has_column_privilege('authenticated', 'public.distributors', 'cnpj', 'select'),
  'usuário autenticado não lê CNPJ pela tabela genérica'
);

select ok(
  has_column_privilege('authenticated', 'public.distributors', 'razao_social', 'select'),
  'campos públicos da distribuidora continuam legíveis'
);

select has_table('public', 'admin_audit_log', 'decisões administrativas possuem audit log');

select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'admin_audit_log'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ),
  'audit log é append-only pela Data API'
);

select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'definir_verificacao'
      and p.prosecdef
  ),
  'decisão de verificação passa por RPC protegida'
);

select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'obter_cnpj_distribuidora'
      and p.prosecdef
  ),
  'leitura excepcional de CNPJ valida dono ou admin no banco'
);

select is(
  (
    select count(*)::integer
      from pg_trigger
     where tgrelid in (
       'public.professional_skills'::regclass,
       'public.professional_tags'::regclass,
       'public.service_areas'::regclass
     )
       and not tgisinternal
       and tgname in ('trg_skills_revalidacao', 'trg_tags_revalidacao', 'trg_areas_revalidacao')
  ),
  3,
  'mudanças de competências e área exigem nova análise'
);

select ok(
  exists (
    select 1 from pg_trigger
     where tgrelid = 'public.distributor_areas'::regclass
       and not tgisinternal
       and tgname = 'trg_dist_areas_revalidacao'
  ),
  'mudança de área da distribuidora exige nova análise'
);

select ok(
  exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'admin_audit_log'
       and policyname = 'admin_audit_read'
       and cmd = 'SELECT'
  ),
  'somente admin possui policy de leitura da auditoria'
);

select * from finish();
rollback;
