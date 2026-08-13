begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(35);

select has_table('public', 'marketplace_regions', 'praças possuem configuração central');
select has_table('public', 'feature_flags', 'feature flags existem');
select has_table('public', 'rate_limit_buckets', 'rate limit possui contador transacional');
select has_table('public', 'system_health_runs', 'execuções de health check são persistidas');
select has_table('public', 'system_health_checks', 'detalhes de saúde são persistidos');

select has_function('public', 'feature_enabled', array['text','text','text'], 'feature flag possui resolução determinística');
select has_function('public', 'consume_rate_limit', array['text','uuid','integer','integer'], 'rate limiter possui operação atômica');
select has_function('public', 'avaliar_saude_sistema', array[]::text[], 'health check possui worker interno');
select has_function('public', 'obter_saude_publica', array[]::text[], 'saúde agregada possui contrato público mínimo');

select is((select launch_stage from public.marketplace_regions where slug = 'sao-paulo-sp'), 'pilot', 'São Paulo nasce como piloto explícito');
select ok(public.feature_enabled('pmoc', 'sao-paulo-sp', 'cliente-a'), 'PMOC está liberado no piloto');
select ok(not public.feature_enabled('asaas_payments', 'sao-paulo-sp', 'cliente-a'), 'pagamentos Asaas continuam desligados');
select is(
  public.feature_enabled('pmoc', 'sao-paulo-sp', 'cliente-deterministico'),
  public.feature_enabled('pmoc', 'sao-paulo-sp', 'cliente-deterministico'),
  'mesmo sujeito recebe decisão estável de rollout'
);
select ok(
  not has_table_privilege('authenticated', 'public.feature_flags', 'INSERT')
  and not has_table_privilege('authenticated', 'public.feature_flags', 'UPDATE'),
  'usuário não altera rollout pela Data API'
);
select ok(
  not has_table_privilege('authenticated', 'public.rate_limit_buckets', 'SELECT'),
  'contador de abuso não é exposto ao usuário'
);
select ok(
  not has_function_privilege('authenticated', 'public.consume_rate_limit(text,uuid,integer,integer)', 'execute'),
  'usuário não consome nem contorna buckets diretamente'
);
select has_index('public', 'rate_limit_buckets', 'idx_rate_limit_buckets_expiry', 'limpeza de buckets usa índice de expiração');

select has_trigger('public', 'quote_requests', 'trg_quote_requests_rate_limit', 'pedidos possuem rate limit no banco');
select has_trigger('public', 'messages', 'trg_messages_rate_limit', 'mensagens possuem rate limit no banco');
select has_trigger('public', 'pmoc_plans', 'trg_pmoc_plans_rate_limit', 'solicitações PMOC possuem rate limit no banco');
select ok(exists (select 1 from cron.job where jobname = 'friohub-system-health' and active), 'health check roda a cada cinco minutos');

select lives_ok('select public.avaliar_saude_sistema()', 'health check completo é reexecutável');
select ok((select count(*) > 0 from public.system_health_runs), 'health check cria uma execução');
select is(
  (select count(*)::integer from public.system_health_checks where run_id = (select id from public.system_health_runs order by started_at desc limit 1)),
  6,
  'execução cobre banco, notificações, webhooks, reconciliação, SLA e PMOC'
);
select ok(has_function_privilege('anon', 'public.obter_saude_publica()', 'execute'), 'status agregado pode alimentar endpoint público');
select ok(not has_table_privilege('anon', 'public.system_health_checks', 'SELECT'), 'detalhes internos não vazam no endpoint público');
select ok(
  not has_table_privilege('authenticated', 'public.system_health_runs', 'INSERT')
  and not has_table_privilege('authenticated', 'public.system_health_checks', 'UPDATE'),
  'usuário não falsifica telemetria'
);
select ok(not has_function_privilege('authenticated', 'public.avaliar_saude_sistema()', 'execute'), 'usuário não dispara worker de saúde');

select lives_ok(
  $$select public.consume_rate_limit('teste_phase5', '80000000-0000-0000-0000-000000000001', 1, 3600)$$,
  'primeiro consumo do bucket é aceito'
);
select throws_ok(
  $$select public.consume_rate_limit('teste_phase5', '80000000-0000-0000-0000-000000000001', 1, 3600)$$,
  'P0001', 'Limite de solicitações excedido. Aguarde antes de tentar novamente.',
  'consumo acima do teto é rejeitado'
);
update public.rate_limit_buckets set expires_at = now() - interval '1 second'
 where scope = 'teste_phase5' and subject_id = '80000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.consume_rate_limit('teste_phase5', '80000000-0000-0000-0000-000000000001', 1, 3600)$$,
  'bucket expirado abre nova janela'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rate-limit@teste.local', '', now(), now());
update public.profiles set role = 'cliente', nome = 'Cliente Rate Limit'
 where id = '80000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000002', true);

select lives_ok($$select public.solicitar_pmoc('Empresa Limite','Unidade 1','01001000','São Paulo',1,3,null)$$, 'primeira solicitação PMOC é aceita');
select lives_ok($$select public.solicitar_pmoc('Empresa Limite','Unidade 2','01001000','São Paulo',1,3,null)$$, 'segunda solicitação PMOC é aceita');
select lives_ok($$select public.solicitar_pmoc('Empresa Limite','Unidade 3','01001000','São Paulo',1,3,null)$$, 'terceira solicitação PMOC é aceita');
select throws_ok(
  $$select public.solicitar_pmoc('Empresa Limite','Unidade 4','01001000','São Paulo',1,3,null)$$,
  'P0001', 'Limite de solicitações excedido. Aguarde antes de tentar novamente.',
  'quarta solicitação PMOC no dia é bloqueada no banco'
);

select * from finish();
rollback;
