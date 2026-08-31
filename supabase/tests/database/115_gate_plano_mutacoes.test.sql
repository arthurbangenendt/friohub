begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

-- ============================================================================
-- Prova de verdade do gate: profissional no plano Grátis é bloqueado nas
-- mutações de Ferramentas, Clientes, Financeiro, Oportunidades e PMOC — não
-- só na tela, mas no banco (RLS ou RPC), pra qualquer caminho de acesso.
-- ============================================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) values
('15000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','gate-cliente@teste.local','',now(),now()),
('15000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','gate-gratis@teste.local','',now(),now());

update public.profiles set role = 'cliente', nome = 'Cliente Gate' where id = '15000000-0000-0000-0000-000000000001';
update public.profiles set role = 'profissional', nome = 'Profissional Grátis' where id = '15000000-0000-0000-0000-000000000002';

insert into public.professionals (id, tipo, cidade, estado, verification_status, subscription_plan_id)
values (
  '15000000-0000-0000-0000-000000000002', 'autonomo', 'São Paulo', 'SP', 'verificado',
  (select id from public.subscription_plans where slug = 'gratuito')
);

-- Job real ligando o profissional ao cliente — necessário pra RLS de
-- professional_client_notes (exige histórico de atendimento).
insert into public.jobs (id, cliente_id, job_type, has_equipment, cep, cidade, profissional_id, status)
values ('15000000-0000-0000-0000-000000000010', '15000000-0000-0000-0000-000000000001', 'limpeza', false, '01001000', 'São Paulo', '15000000-0000-0000-0000-000000000002', 'concluido');

insert into public.quote_requests (id, cliente_id, job_type, cep, cidade, quantidade, detalhes)
values ('15000000-0000-0000-0000-000000000011', '15000000-0000-0000-0000-000000000001', 'manutencao', '01001000', 'São Paulo', 1, '{}');
insert into public.quote_request_targets (quote_request_id, professional_id)
values ('15000000-0000-0000-0000-000000000011', '15000000-0000-0000-0000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000002', true);

select throws_ok(
  $$insert into public.professional_tools (professional_id, name, category, acquired_on)
    values ('15000000-0000-0000-0000-000000000002', 'Furadeira', 'eletrica', current_date)$$,
  'new row violates row-level security policy for table "professional_tools"',
  'Ferramentas: profissional no Grátis não cadastra ferramenta'
);

select throws_ok(
  $$insert into public.expenses (professional_id, categoria, valor, data)
    values ('15000000-0000-0000-0000-000000000002', 'material', 50, current_date)$$,
  'new row violates row-level security policy for table "expenses"',
  'Financeiro: profissional no Grátis não registra despesa manual'
);

select throws_ok(
  $$insert into public.professional_client_notes (professional_id, customer_id, notes)
    values ('15000000-0000-0000-0000-000000000002', '15000000-0000-0000-0000-000000000001', 'nota qualquer')$$,
  'new row violates row-level security policy for table "professional_client_notes"',
  'Clientes: profissional no Grátis não salva nota de cliente'
);

select throws_ok(
  $$select public.criar_follow_up('15000000-0000-0000-0000-000000000011', now() + interval '1 day', 'Retornar')$$,
  'Follow-up de oportunidades é exclusivo do seu plano.',
  'Oportunidades: profissional no Grátis não cria follow-up'
);

select throws_ok(
  $$select public.propor_pmoc_profissional(
      '15000000-0000-0000-0000-000000000001', 'Empresa Teste', 'Unidade Teste', '01001000', 'São Paulo',
      5, 3, 200, current_date + 7, null
    )$$,
  'Propor PMOC é exclusivo do seu plano.',
  'PMOC: profissional no Grátis não propõe PMOC'
);

reset role;

-- Confirma que, com plano Master, as mesmas ações passam — o gate não está
-- travando todo mundo, só quem não tem a feature.
update public.professionals set subscription_plan_id = (select id from public.subscription_plans where slug = 'master')
 where id = '15000000-0000-0000-0000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000002', true);

select lives_ok(
  $$insert into public.professional_tools (professional_id, name, category, acquired_on)
    values ('15000000-0000-0000-0000-000000000002', 'Furadeira', 'eletrica', current_date)$$,
  'Ferramentas: profissional no Master cadastra ferramenta normalmente'
);

select lives_ok(
  $$insert into public.professional_client_notes (professional_id, customer_id, notes)
    values ('15000000-0000-0000-0000-000000000002', '15000000-0000-0000-0000-000000000001', 'nota qualquer')$$,
  'Clientes: profissional no Master salva nota de cliente normalmente'
);

select lives_ok(
  $$select public.criar_follow_up('15000000-0000-0000-0000-000000000011', now() + interval '1 day', 'Retornar')$$,
  'Oportunidades: profissional no Master cria follow-up normalmente'
);

reset role;

select * from finish();
rollback;
