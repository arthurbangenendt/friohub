begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(36);

select has_table('public', 'pmoc_plans', 'planos PMOC existem');
select has_table('public', 'pmoc_visits', 'visitas PMOC existem');
select has_table('public', 'pmoc_plan_events', 'histórico PMOC existe');
select has_function(
  'public', 'solicitar_pmoc', array['text','text','text','text','integer','integer','text'],
  'cliente possui comando explícito para solicitar PMOC'
);
select has_function(
  'public', 'atribuir_pmoc', array['uuid','uuid'],
  'admin possui comando explícito para atribuir PMOC'
);
select has_function(
  'public', 'responder_pmoc', array['uuid','boolean','numeric','date'],
  'profissional possui comando explícito para responder PMOC'
);
select has_function(
  'public', 'processar_pmoc_recorrente', array[]::text[],
  'recorrência PMOC possui worker no banco'
);

select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('pmoc_plans','pmoc_visits','pmoc_plan_events')
       and cmd in ('INSERT','UPDATE','DELETE','ALL')
  ),
  'Data API não escreve diretamente no domínio PMOC'
);
select ok(
  not has_table_privilege('authenticated', 'public.pmoc_plans', 'INSERT')
  and not has_table_privilege('authenticated', 'public.pmoc_visits', 'UPDATE'),
  'papel autenticado só escreve PMOC por RPC'
);
select ok(
  not has_function_privilege('anon', 'public.solicitar_pmoc(text,text,text,text,integer,integer,text)', 'execute')
  and has_function_privilege('authenticated', 'public.solicitar_pmoc(text,text,text,text,integer,integer,text)', 'execute'),
  'solicitação PMOC exige autenticação'
);
select ok(
  not has_function_privilege('authenticated', 'public.processar_pmoc_recorrente()', 'execute'),
  'usuário não executa o worker recorrente'
);
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'idx_pmoc_plans_due'
       and indexdef ilike '%where%'
  ),
  'agenda recorrente usa índice parcial'
);
select ok(
  exists (
    select 1 from cron.job where jobname = 'friohub-pmoc-recorrente' and active
  ),
  'cron PMOC está ativo'
);
select ok(
  exists (
    select 1 from pg_constraint
     where conrelid = 'public.notification_outbox'::regclass
       and conname = 'notification_outbox_event_type_check'
       and pg_get_constraintdef(oid) ilike '%pmoc_visit_due%'
  ),
  'outbox aceita eventos PMOC sem fila paralela'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cliente-pmoc@teste.local', '', now(), now()),
  ('70000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro-consistente@teste.local', '', now(), now()),
  ('70000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro-novo@teste.local', '', now(), now()),
  ('70000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-pmoc@teste.local', '', now(), now());

update public.profiles set role = 'cliente', nome = 'Cliente PMOC'
 where id = '70000000-0000-0000-0000-000000000001';
update public.profiles set role = 'profissional', nome = 'Pro Consistente'
 where id = '70000000-0000-0000-0000-000000000002';
update public.profiles set role = 'profissional', nome = 'Pro Novo Cinco Estrelas'
 where id = '70000000-0000-0000-0000-000000000003';
update public.profiles set role = 'admin', nome = 'Admin PMOC'
 where id = '70000000-0000-0000-0000-000000000004';

insert into public.professionals (id, tipo, cidade, estado)
values
  ('70000000-0000-0000-0000-000000000002', 'empresa', 'São Paulo', 'SP'),
  ('70000000-0000-0000-0000-000000000003', 'autonomo', 'São Paulo', 'SP');
insert into public.professional_skills (
  professional_id, specialty, years_experience, rating_avg, rating_count, jobs_completed
) values
  ('70000000-0000-0000-0000-000000000002', 'manutencao', 12, 4.70, 30, 30),
  ('70000000-0000-0000-0000-000000000003', 'manutencao', 1, 5.00, 1, 1);
insert into public.service_areas (professional_id, cep_prefix, cidade)
values
  ('70000000-0000-0000-0000-000000000002', '010', 'São Paulo'),
  ('70000000-0000-0000-0000-000000000003', '010', 'São Paulo');
insert into public.professional_tags (professional_id, tag_slug)
values ('70000000-0000-0000-0000-000000000002', 'pmoc');
update public.professionals
   set verification_status = 'verificado', verified_at = now()
 where id in (
   '70000000-0000-0000-0000-000000000002',
   '70000000-0000-0000-0000-000000000003'
 );

select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);

select is(
  (select professional_id from public.buscar_profissionais_marketplace(
    '01001-000', 'manutencao', null, 'relevancia', true, 1, 0
  )),
  '70000000-0000-0000-0000-000000000002'::uuid,
  'quality_v1 prioriza histórico consistente sobre uma única nota cinco'
);
select is(
  (select professional_id from public.buscar_profissionais_marketplace(
    '01001-000', 'manutencao', null, 'nota', true, 1, 0
  )),
  '70000000-0000-0000-0000-000000000003'::uuid,
  'ordenação explícita por nota continua disponível'
);

create temporary table phase4_pmoc_ids (plan_id uuid, first_visit uuid, recurring_visit uuid)
on commit drop;
insert into phase4_pmoc_ids default values;

update phase4_pmoc_ids set plan_id = public.solicitar_pmoc(
  'Empresa Teste', 'Unidade Centro', '01001-000', 'São Paulo', 24, 3,
  'Operação comercial com equipamentos split.'
);

select is(
  (select status from public.pmoc_plans where id = (select plan_id from phase4_pmoc_ids)),
  'requested',
  'solicitação nasce aguardando atribuição'
);
select is(
  (select count(*)::integer from public.pmoc_plan_events
    where plan_id = (select plan_id from phase4_pmoc_ids) and event_type = 'requested'),
  1,
  'solicitação gera histórico imutável'
);

select throws_ok(
  format(
    'select public.atribuir_pmoc(%L::uuid,%L::uuid)',
    (select plan_id from phase4_pmoc_ids),
    '70000000-0000-0000-0000-000000000002'
  ),
  'P0001', 'Acesso restrito a administradores.',
  'cliente não atribui o próprio PMOC'
);

select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000004', true);
select lives_ok(
  format(
    'select public.atribuir_pmoc(%L::uuid,%L::uuid)',
    (select plan_id from phase4_pmoc_ids),
    '70000000-0000-0000-0000-000000000002'
  ),
  'admin atribui profissional verificado, habilitado e da região'
);
select is(
  (select status from public.pmoc_plans where id = (select plan_id from phase4_pmoc_ids)),
  'offered',
  'atribuição aguarda aceite do profissional'
);
select is(
  (select count(*)::integer from public.notification_outbox
    where aggregate_id = (select plan_id from phase4_pmoc_ids) and event_type = 'pmoc_offered'),
  1,
  'atribuição gera notificação idempotente'
);

select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000002', true);
select lives_ok(
  format(
    'select public.responder_pmoc(%L::uuid,true,450,current_date + 7)',
    (select plan_id from phase4_pmoc_ids)
  ),
  'profissional aceita PMOC com preço e primeira visita'
);
update phase4_pmoc_ids set first_visit = (
  select id from public.pmoc_visits where plan_id = (select plan_id from phase4_pmoc_ids)
  order by due_date limit 1
);
select is(
  (select status from public.pmoc_plans where id = (select plan_id from phase4_pmoc_ids)),
  'active',
  'aceite ativa o plano'
);
select is(
  (select price_per_visit from public.pmoc_plans where id = (select plan_id from phase4_pmoc_ids)),
  450.00::numeric,
  'preço acordado fica congelado no plano'
);
select is(
  (select count(*)::integer from public.pmoc_visits
    where plan_id = (select plan_id from phase4_pmoc_ids)),
  1,
  'aceite agenda a primeira visita'
);

update public.pmoc_plans set next_due_date = current_date + 10
 where id = (select plan_id from phase4_pmoc_ids);
select lives_ok('select public.processar_pmoc_recorrente()', 'worker gera próxima visita dentro da janela');
update phase4_pmoc_ids set recurring_visit = (
  select id from public.pmoc_visits
   where plan_id = (select plan_id from phase4_pmoc_ids)
     and id <> (select first_visit from phase4_pmoc_ids)
   limit 1
);
select is(
  (select count(*)::integer from public.pmoc_visits
    where plan_id = (select plan_id from phase4_pmoc_ids)),
  2,
  'recorrência cria uma única nova visita'
);
select lives_ok('select public.processar_pmoc_recorrente()', 'reexecução do worker é segura');
select is(
  (select count(*)::integer from public.pmoc_visits
    where plan_id = (select plan_id from phase4_pmoc_ids)),
  2,
  'worker repetido não duplica visita'
);

select lives_ok(
  format(
    'select public.concluir_visita_pmoc(%L::uuid,%L)',
    (select first_visit from phase4_pmoc_ids), 'Checklist e higienização concluídos.'
  ),
  'profissional conclui visita com evidência textual'
);
select is(
  (select status from public.pmoc_visits where id = (select first_visit from phase4_pmoc_ids)),
  'completed',
  'visita concluída não permanece pendente'
);
select throws_ok(
  format(
    'update public.pmoc_plan_events set metadata = %L::jsonb where plan_id = %L::uuid',
    '{}', (select plan_id from phase4_pmoc_ids)
  ),
  'P0001', 'Histórico PMOC é imutável.',
  'histórico PMOC não pode ser reescrito'
);

select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
select lives_ok(
  format(
    'select public.cancelar_pmoc(%L::uuid,%L)',
    (select plan_id from phase4_pmoc_ids), 'Contrato encerrado pelo cliente.'
  ),
  'cliente cancela o próprio PMOC com motivo'
);
select is(
  (select status from public.pmoc_plans where id = (select plan_id from phase4_pmoc_ids)),
  'cancelled',
  'cancelamento encerra recorrência'
);
select is(
  (select status from public.pmoc_visits where id = (select recurring_visit from phase4_pmoc_ids)),
  'cancelled',
  'cancelamento encerra visita futura pendente'
);

select * from finish();
rollback;
