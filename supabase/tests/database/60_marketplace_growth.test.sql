begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(30);

select has_function(
  'public', 'profissional_atende_cep', array['uuid', 'text'],
  'regra territorial existe no banco'
);
select has_function(
  'public', 'buscar_produtos_marketplace', array['integer', 'text', 'integer', 'integer'],
  'catálogo possui busca paginada'
);
select has_function(
  'public', 'buscar_profissionais_marketplace',
  array['text', 'text', 'text', 'text', 'boolean', 'integer', 'integer'],
  'profissionais possuem busca paginada por CEP'
);
select has_function(
  'public', 'obter_funil_marketplace', array['integer', 'text'],
  'funil administrativo existe'
);
select is(
  (select prosecdef from pg_proc where oid =
    'public.buscar_profissionais_marketplace(text,text,text,text,boolean,integer,integer)'::regprocedure),
  true,
  'agregados de resposta são calculados de modo consistente sob RLS'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.buscar_profissionais_marketplace(text,text,text,text,boolean,integer,integer)',
    'execute'
  ) and has_function_privilege(
    'authenticated',
    'public.buscar_profissionais_marketplace(text,text,text,text,boolean,integer,integer)',
    'execute'
  ),
  'matching exige autenticação'
);
select ok(
  has_function_privilege(
    'anon', 'public.buscar_produtos_marketplace(integer,text,integer,integer)', 'execute'
  ),
  'catálogo de produtos permanece público'
);
select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'featured_placements'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  )
  and not has_table_privilege('authenticated', 'public.featured_placements', 'INSERT'),
  'profissional não cria destaque patrocinado sem compra e auditoria'
);
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'idx_service_areas_professional_prefix'
  ),
  'matching possui índice por profissional e prefixo'
);
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'idx_jobs_professional_active'
       and indexdef ilike '%where%'
  ),
  'disponibilidade usa índice parcial de serviços ativos'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cliente-growth@teste.local', '', now(), now()),
  ('60000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro-centro@teste.local', '', now(), now()),
  ('60000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro-outra-area@teste.local', '', now(), now()),
  ('60000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-growth@teste.local', '', now(), now());

update public.profiles set role = 'cliente', nome = 'Cliente Growth'
 where id = '60000000-0000-0000-0000-000000000001';
update public.profiles set role = 'profissional', nome = 'Técnico Centro'
 where id = '60000000-0000-0000-0000-000000000002';
update public.profiles set role = 'profissional', nome = 'Técnico Outra Área'
 where id = '60000000-0000-0000-0000-000000000003';
update public.profiles set role = 'admin', nome = 'Admin Growth'
 where id = '60000000-0000-0000-0000-000000000004';

insert into public.professionals (id, tipo, cidade, estado, verification_status)
values
  ('60000000-0000-0000-0000-000000000002', 'autonomo', 'São Paulo', 'SP', 'verificado'),
  ('60000000-0000-0000-0000-000000000003', 'autonomo', 'São Paulo', 'SP', 'verificado');

insert into public.professional_skills (
  professional_id, specialty, years_experience, rating_avg, rating_count, jobs_completed
) values
  ('60000000-0000-0000-0000-000000000002', 'limpeza', 8, 4.80, 10, 9),
  ('60000000-0000-0000-0000-000000000003', 'limpeza', 5, 4.90, 12, 11);

insert into public.service_areas (professional_id, cep_prefix, cidade)
values
  ('60000000-0000-0000-0000-000000000002', '010', 'São Paulo'),
  ('60000000-0000-0000-0000-000000000003', '020', 'São Paulo'),
  ('60000000-0000-0000-0000-000000000003', 'abc', 'São Paulo');

-- Alterar área corretamente reabre a verificação; o fixture simula a aprovação
-- administrativa posterior para testar o filtro de profissionais verificados.
update public.professionals
   set verification_status = 'verificado', verified_at = now()
 where id in (
   '60000000-0000-0000-0000-000000000002',
   '60000000-0000-0000-0000-000000000003'
 );

select ok(
  public.profissional_atende_cep('60000000-0000-0000-0000-000000000002', '01001-000'),
  'CEP formatado é coberto pelo prefixo cadastrado'
);
select ok(
  not public.profissional_atende_cep('60000000-0000-0000-0000-000000000002', '02001-000'),
  'profissional não atende CEP fora da própria área'
);
select ok(
  not public.profissional_atende_cep('60000000-0000-0000-0000-000000000003', '00000-000'),
  'prefixo não numérico nunca entra no matching'
);

select set_config('request.jwt.claim.sub', '60000000-0000-0000-0000-000000000001', true);

select is(
  (select count(*)::integer from public.buscar_profissionais_marketplace(
    '01001-000', 'limpeza', null, 'relevancia', true, 12, 0
  )),
  1,
  'busca retorna somente o profissional da área solicitada'
);
select is(
  (select professional_id from public.buscar_profissionais_marketplace(
    '01001-000', 'limpeza', null, 'relevancia', true, 12, 0
  )),
  '60000000-0000-0000-0000-000000000002'::uuid,
  'matching territorial retorna o destinatário correto'
);
select is(
  (select count(*)::integer from public.buscar_profissionais_marketplace(
    '01001-000', 'conserto', null, 'relevancia', true, 12, 0
  )),
  0,
  'especialidade incompatível é excluída'
);
select is(
  (select count(*)::integer from public.buscar_profissionais_marketplace(
    '01001-000', 'limpeza', 'nome inexistente', 'relevancia', true, 12, 0
  )),
  0,
  'busca por nome é aplicada no banco'
);

select throws_ok(
  $$select public.criar_pedido_orcamento(
    'limpeza', '01001-000', 'São Paulo', 'Sé', 1, 'sem_pressa', null, '{}'::jsonb,
    null, null, array['60000000-0000-0000-0000-000000000003'::uuid], '{}'::text[]
  )$$,
  'P0001',
  'Um ou mais profissionais não atendem este CEP ou serviço.',
  'RPC rejeita destinatário fora da área mesmo sem passar pela interface'
);

create temporary table phase4_ids (request1 uuid, request2 uuid) on commit drop;
insert into phase4_ids default values;

select lives_ok(
  $$update phase4_ids set request1 = public.criar_pedido_orcamento(
    'limpeza', '01001-000', 'São Paulo', 'Sé', 1, 'sem_pressa', null, '{}'::jsonb,
    null, null, array['60000000-0000-0000-0000-000000000002'::uuid], '{}'::text[]
  )$$,
  'pedido válido para a área é criado'
);
select is(
  (select count(*)::integer from public.quote_request_targets
    where quote_request_id = (select request1 from phase4_ids)
      and professional_id = '60000000-0000-0000-0000-000000000002'),
  1,
  'pedido persiste exatamente o destinatário validado'
);
select lives_ok(
  $$update phase4_ids set request2 = public.criar_pedido_orcamento(
    'limpeza', '01001-000', 'São Paulo', 'Sé', 1, 'sem_pressa', null, '{}'::jsonb,
    null, null, array['60000000-0000-0000-0000-000000000002'::uuid], '{}'::text[]
  )$$,
  'segunda solicitação permite medir recorrência'
);

update public.quote_requests
   set created_at = created_at - interval '1 minute'
 where id = (select request1 from phase4_ids);

insert into public.quotes (
  quote_request_id, professional_id, tipo, valor_mao_obra, status
) values (
  (select request1 from phase4_ids),
  '60000000-0000-0000-0000-000000000002',
  'preco_fechado', 250, 'aceita'
);

insert into public.jobs (
  id, quote_request_id, cliente_id, job_type, has_equipment, cep, cidade,
  profissional_id, status
) values (
  '60000000-0000-0000-0000-000000000010',
  (select request1 from phase4_ids),
  '60000000-0000-0000-0000-000000000001',
  'limpeza', false, '01001000', 'São Paulo',
  '60000000-0000-0000-0000-000000000002', 'concluido'
);

select ok(
  (select count(*) from public.buscar_produtos_marketplace(12000, null, 5, 0)) <= 5,
  'catálogo respeita o limite de página'
);
select ok(
  (select count(*) from public.buscar_produtos_marketplace(null, 'Midea', 12, 0)) >= 1,
  'catálogo busca por marca ou modelo'
);

select throws_ok(
  $$select * from public.obter_funil_marketplace(30, 'São Paulo')$$,
  'P0001',
  'Acesso restrito a administradores.',
  'cliente não lê métricas agregadas administrativas'
);

select set_config('request.jwt.claim.sub', '60000000-0000-0000-0000-000000000004', true);

select is(
  (select requested from public.obter_funil_marketplace(30, 'São Paulo')),
  2::bigint,
  'funil usa pedidos da coorte como denominador'
);
select is(
  (select responded from public.obter_funil_marketplace(30, 'São Paulo')),
  1::bigint,
  'funil mede primeira resposta'
);
select is(
  (select accepted from public.obter_funil_marketplace(30, 'São Paulo')),
  1::bigint,
  'funil mede aceite'
);
select is(
  (select started from public.obter_funil_marketplace(30, 'São Paulo')),
  1::bigint,
  'funil mede execução'
);
select is(
  (select completed from public.obter_funil_marketplace(30, 'São Paulo')),
  1::bigint,
  'funil mede conclusão'
);
select is(
  (select repeat_customers from public.obter_funil_marketplace(30, 'São Paulo')),
  1::bigint,
  'funil mede cliente recorrente sem evento do navegador'
);

select * from finish();
rollback;
