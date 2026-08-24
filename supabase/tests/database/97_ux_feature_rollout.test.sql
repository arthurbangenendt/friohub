begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);

select has_function('public','configurar_feature_flag',array['text','text','boolean','integer','text'],'configuração administrativa existe');
select is((select count(*)::integer from public.feature_flags where flag_key like 'ux_%'),4,'quatro domínios possuem flags');
select is((select count(*)::integer from public.feature_flags where flag_key like 'ux_%' and enabled),4,'flags UX iniciam ativas');
select is((select count(*)::integer from public.feature_flags where flag_key like 'ux_%' and rollout_percentage=100),4,'piloto inicia em 100%');
select ok(not has_function_privilege('anon','public.configurar_feature_flag(text,text,boolean,integer,text)','EXECUTE'),'anônimo não configura rollout');
select ok(has_function_privilege('authenticated','public.configurar_feature_flag(text,text,boolean,integer,text)','EXECUTE'),'autenticado pode chegar ao comando protegido');
select ok(public.feature_enabled('ux_pipeline','sao-paulo-sp','subject-a'),'flag ativa atende sujeito do piloto');
select ok(not has_table_privilege('anon','public.admin_audit_log','SELECT'),'anônimo não lê auditoria');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('97000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rollout-user@teste.local','',now(),now()),
('97000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rollout-admin@teste.local','',now(),now());
update public.profiles set role='cliente' where id='97000000-0000-0000-0000-000000000001';
update public.profiles set role='admin' where id='97000000-0000-0000-0000-000000000002';

select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000001',true);
select throws_ok(
  $$select public.configurar_feature_flag('ux_growth','sao-paulo-sp',false,0,'Tentativa sem autorização')$$,
  'P0001','Acesso restrito a administradores.','usuário comum não altera rollout'
);

select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000002',true);
select lives_ok(
  $$select public.configurar_feature_flag('ux_growth','sao-paulo-sp',false,0,'Teste controlado de rollback')$$,
  'admin altera rollout'
);
select ok(not public.feature_enabled('ux_growth','sao-paulo-sp','subject-a'),'flag desativada bloqueia sujeito');
select is((select count(*)::integer from public.admin_audit_log where action='feature_flag_changed' and entity_type='feature_flag' and reason='Teste controlado de rollback'),1,'alteração gera auditoria');
select is((select (old_values->>'enabled')::boolean from public.admin_audit_log where action='feature_flag_changed' order by created_at desc limit 1),true,'auditoria preserva estado anterior');
select is((select (new_values->>'enabled')::boolean from public.admin_audit_log where action='feature_flag_changed' order by created_at desc limit 1),false,'auditoria preserva estado novo');
select throws_ok(
  $$select public.configurar_feature_flag('ux_pipeline','sao-paulo-sp',true,101,'Percentual inválido para teste')$$,
  'P0001','Percentual de rollout inválido.','percentual fora do limite é rejeitado'
);
select throws_ok(
  $$select public.configurar_feature_flag('ux_pipeline','sao-paulo-sp',true,100,'x')$$,
  'P0001','Informe uma justificativa entre 5 e 500 caracteres.','justificativa curta é rejeitada'
);
select throws_ok(
  $$select public.configurar_feature_flag('ux_inexistente','sao-paulo-sp',true,100,'Flag inexistente para teste')$$,
  'P0001','Feature flag regional não encontrada.','flag inexistente é rejeitada'
);

select * from finish();
rollback;
