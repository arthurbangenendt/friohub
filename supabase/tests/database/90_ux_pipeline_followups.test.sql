begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(22);

select has_table('public', 'follow_up_tasks', 'tarefas de follow-up existem');
select has_table('public', 'follow_up_events', 'histórico de follow-up existe');
select has_function('public', 'criar_follow_up', array['uuid','timestamp with time zone','text'], 'criação usa comando explícito');
select has_function('public', 'adiar_follow_up', array['uuid','timestamp with time zone'], 'adiamento usa comando explícito');
select has_function('public', 'concluir_follow_up', array['uuid','text','text'], 'conclusão usa comando explícito');
select ok(not has_table_privilege('authenticated', 'public.follow_up_tasks', 'INSERT'), 'Data API não insere tarefa diretamente');
select ok(not has_table_privilege('authenticated', 'public.follow_up_tasks', 'UPDATE'), 'Data API não atualiza tarefa diretamente');
select ok(not has_table_privilege('anon', 'public.follow_up_tasks', 'SELECT'), 'anônimo não lê follow-up');
select has_index('public', 'follow_up_tasks', 'uq_follow_up_pending_per_opportunity', 'existe uma tarefa pendente por oportunidade');
select has_index('public', 'follow_up_tasks', 'idx_follow_up_professional_due', 'fila pendente possui índice parcial');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
 ('90000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cliente-follow@teste.local','',now(),now()),
 ('90000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pro-follow@teste.local','',now(),now()),
 ('90000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','intruso-follow@teste.local','',now(),now());
update public.profiles set role = 'cliente' where id = '90000000-0000-0000-0000-000000000001';
update public.profiles set role = 'profissional' where id in ('90000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000003');
insert into public.professionals (id, tipo, cidade, estado, subscription_plan_id) values
 ('90000000-0000-0000-0000-000000000002','autonomo','São Paulo','SP',(select id from public.subscription_plans where slug = 'master')),
 ('90000000-0000-0000-0000-000000000003','autonomo','São Paulo','SP',(select id from public.subscription_plans where slug = 'master'));
insert into public.quote_requests (id, cliente_id, job_type, cep, cidade, quantidade, detalhes)
values ('90000000-0000-0000-0000-000000000010','90000000-0000-0000-0000-000000000001','manutencao','01001000','São Paulo',1,'{}');
insert into public.quote_request_targets (quote_request_id, professional_id)
values ('90000000-0000-0000-0000-000000000010','90000000-0000-0000-0000-000000000002');

select set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000003', true);
select throws_ok(
 $$select public.criar_follow_up('90000000-0000-0000-0000-000000000010', now() + interval '1 day', 'Retornar')$$,
 'P0001', 'Acesso negado à oportunidade.', 'profissional alheio não cria follow-up'
);

select set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000002', true);
create temporary table ux_ids (task_id uuid) on commit drop;
insert into ux_ids values (public.criar_follow_up(
 '90000000-0000-0000-0000-000000000010', now() + interval '1 day', 'Retornar proposta'
));
select is((select status from public.follow_up_tasks where id = (select task_id from ux_ids)), 'pending', 'tarefa nasce pendente');
select is((select professional_id from public.follow_up_tasks where id = (select task_id from ux_ids)), '90000000-0000-0000-0000-000000000002'::uuid, 'dono vem da sessão');
select is((select count(*)::integer from public.follow_up_events where task_id = (select task_id from ux_ids)), 1, 'criação gera evento');
select throws_ok(
 $$select public.criar_follow_up('90000000-0000-0000-0000-000000000010', now() + interval '2 days', 'Duplicado')$$,
 '23505', null, 'não duplica tarefa pendente na mesma oportunidade'
);
select lives_ok(
 format('select public.adiar_follow_up(%L::uuid, now() + interval ''2 days'')', (select task_id from ux_ids)),
 'dono adia a tarefa'
);
select is((select count(*)::integer from public.follow_up_events where task_id = (select task_id from ux_ids)), 2, 'adiamento gera evento');

select set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000003', true);
select throws_ok(
 format('select public.concluir_follow_up(%L::uuid,%L,%L)', (select task_id from ux_ids), 'contacted', 'Tentativa'),
 'P0001', 'Follow-up pendente não encontrado.', 'profissional alheio não conclui a tarefa'
);

select set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000002', true);
select lives_ok(
 format('select public.concluir_follow_up(%L::uuid,%L,%L)', (select task_id from ux_ids), 'contacted', 'Cliente respondeu.'),
 'dono conclui a tarefa'
);
select is((select status from public.follow_up_tasks where id = (select task_id from ux_ids)), 'completed', 'conclusão muda o estado');
select is((select outcome from public.follow_up_tasks where id = (select task_id from ux_ids)), 'contacted', 'resultado estruturado é preservado');
select throws_ok(
 format('update public.follow_up_events set metadata = %L::jsonb where task_id = %L::uuid', '{}', (select task_id from ux_ids)),
 'P0001', 'Histórico de follow-up é imutável.', 'histórico não pode ser reescrito'
);

select * from finish();
rollback;
