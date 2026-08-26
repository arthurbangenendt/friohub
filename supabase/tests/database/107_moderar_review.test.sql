begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(15);

select has_function('public', 'moderar_review', array['text','uuid','boolean','text'], 'RPC de moderação existe');
select has_column('public', 'reviews', 'oculta_em', 'reviews ganhou coluna de ocultação');
select has_column('public', 'client_reviews', 'oculta_em', 'client_reviews ganhou coluna de ocultação');

-- ===========================================================================
-- Fixture: admin, cliente, dois profissionais (um avaliado, outro sem
-- vínculo com o cliente — pra testar que ele NUNCA vê a review do cliente).
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) values
('d1000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-review@teste.local','',now(),now()),
('d1000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cliente-review@teste.local','',now(),now()),
('d1000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pro-review@teste.local','',now(),now()),
('d1000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','outro-pro-review@teste.local','',now(),now());

update public.profiles set role='admin', nome='Admin Review' where id='d1000000-0000-0000-0000-000000000001';
update public.profiles set role='cliente', nome='Cliente Review' where id='d1000000-0000-0000-0000-000000000002';
update public.profiles set role='profissional', nome='Pro Review' where id='d1000000-0000-0000-0000-000000000003';
update public.profiles set role='profissional', nome='Outro Pro Review' where id='d1000000-0000-0000-0000-000000000004';

insert into public.professionals (id, tipo, cidade, estado, verification_status) values
('d1000000-0000-0000-0000-000000000003','autonomo','São Paulo','SP','verificado'),
('d1000000-0000-0000-0000-000000000004','autonomo','São Paulo','SP','verificado');

insert into public.jobs (id, cliente_id, job_type, has_equipment, cep, cidade, profissional_id, status) values
('d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000002','limpeza',false,'01001000','São Paulo','d1000000-0000-0000-0000-000000000003','concluido');

insert into public.reviews (id, job_id, cliente_id, professional_id, specialty, rating, comment) values
('d3000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000003','limpeza',5,'ótimo serviço');

insert into public.client_reviews (id, job_id, professional_id, cliente_id, rating) values
('d4000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000003','d1000000-0000-0000-0000-000000000002',4);

-- ---------------------------------------------------------------------------
-- Não-admin não modera.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000002',true);
select throws_ok(
  $$select public.moderar_review('reviews', 'd3000000-0000-0000-0000-000000000001', true, 'não gostei da nota')$$,
  'Acesso restrito a administradores.',
  'cliente não modera review'
);
reset role;

-- ---------------------------------------------------------------------------
-- Antes de ocultar: qualquer authenticated vê a review pública; o outro
-- profissional (sem vínculo) NUNCA vê a client_review deste cliente.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000004',true);
select is(
  (select count(*)::int from public.reviews where id='d3000000-0000-0000-0000-000000000001'),
  1,
  'review pública visível a qualquer authenticated antes de ocultar'
);
select is(
  (select count(*)::int from public.client_reviews where id='d4000000-0000-0000-0000-000000000001'),
  0,
  'profissional sem vínculo nunca vê a client_review, oculta ou não'
);
reset role;

-- ---------------------------------------------------------------------------
-- Admin oculta as duas.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000001',true);
select lives_ok(
  $$select public.moderar_review('reviews', 'd3000000-0000-0000-0000-000000000001', true, 'denúncia de review falsa confirmada')$$,
  'admin oculta review de profissional'
);
select lives_ok(
  $$select public.moderar_review('client_reviews', 'd4000000-0000-0000-0000-000000000001', true, 'tag incompatível com o relato do cliente')$$,
  'admin oculta client_review'
);
reset role;

select is(
  (select action from public.admin_audit_log where entity_type='reviews' and entity_id='d3000000-0000-0000-0000-000000000001' order by created_at desc limit 1),
  'review_moderated',
  'ocultação da review ficou auditada'
);

-- ---------------------------------------------------------------------------
-- Depois de ocultar: cliente comum some, admin continua vendo.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000004',true);
select is(
  (select count(*)::int from public.reviews where id='d3000000-0000-0000-0000-000000000001'),
  0,
  'review oculta some da leitura pública'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000003',true);
select is(
  (select count(*)::int from public.client_reviews where id='d4000000-0000-0000-0000-000000000001'),
  0,
  'client_review oculta some até de quem tinha vínculo'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000001',true);
select is(
  (select count(*)::int from public.reviews where id='d3000000-0000-0000-0000-000000000001'),
  1,
  'admin continua vendo a review oculta'
);
reset role;

-- ---------------------------------------------------------------------------
-- Restaurar: volta a aparecer, com justificativa também obrigatória.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000001',true);
select throws_ok(
  $$select public.moderar_review('reviews', 'd3000000-0000-0000-0000-000000000001', false, 'x')$$,
  'Informe uma justificativa entre 5 e 500 caracteres.',
  'justificativa curta é recusada mesmo pra restaurar'
);
select lives_ok(
  $$select public.moderar_review('reviews', 'd3000000-0000-0000-0000-000000000001', false, 'denúncia era improcedente, restaurando')$$,
  'admin restaura a review'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000004',true);
select is(
  (select count(*)::int from public.reviews where id='d3000000-0000-0000-0000-000000000001'),
  1,
  'review restaurada volta a aparecer pra qualquer authenticated'
);
reset role;

select * from finish();
rollback;
