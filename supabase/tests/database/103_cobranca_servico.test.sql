begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

select ok(
  not has_function_privilege('authenticated', 'public.preparar_cobranca_servico(uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.preparar_cobranca_servico(uuid,uuid)', 'execute'),
  'somente backend confiável prepara cobrança de serviço'
);
select ok(
  not has_function_privilege('authenticated', 'public.obter_cpf_cnpj_cliente(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.obter_cpf_cnpj_cliente(uuid)', 'execute'),
  'documento do cliente só é lido pelo backend confiável'
);

-- ===========================================================================
-- Fixture: dois clientes, cada um com o próprio job/order.
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) values
('f0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cliente-cobranca-1@teste.local','',now(),now()),
('f0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cliente-cobranca-2@teste.local','',now(),now()),
('f0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pro-cobranca@teste.local','',now(),now());

update public.profiles set role='cliente', nome='Cliente Cobrança 1' where id='f0000000-0000-0000-0000-000000000001';
update public.profiles set role='cliente', nome='Cliente Cobrança 2' where id='f0000000-0000-0000-0000-000000000002';
update public.profiles set role='profissional', nome='Profissional Cobrança' where id='f0000000-0000-0000-0000-000000000003';

insert into public.professionals (id, tipo, cidade, estado, verification_status)
values ('f0000000-0000-0000-0000-000000000003','autonomo','São Paulo','SP','verificado');

insert into public.jobs (id, cliente_id, job_type, has_equipment, cep, cidade, profissional_id, status) values
('a1000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','limpeza',false,'01001000','São Paulo','f0000000-0000-0000-0000-000000000003','aguardando_profissional');

insert into public.orders (id, job_id, preco_servico, comissao_servico, total, payment_status) values
('a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001',300,21,300,'pendente');

-- Dono de verdade consegue preparar a cobrança.
select lives_ok(
  $$select public.preparar_cobranca_servico('a1000000-0000-0000-0000-000000000001'::uuid, 'f0000000-0000-0000-0000-000000000001'::uuid)$$,
  'cliente dono do job prepara a própria cobrança'
);
select is(
  (select count(*)::integer from public.payment_charges where order_id = 'a2000000-0000-0000-0000-000000000001'),
  1,
  'cobrança foi criada para a order certa'
);

-- Outro cliente não pode cobrar o job de ninguém mais — nem pelo id certo.
select throws_ok(
  $$select public.preparar_cobranca_servico('a1000000-0000-0000-0000-000000000001'::uuid, 'f0000000-0000-0000-0000-000000000002'::uuid)$$,
  'Serviço não encontrado para este cliente.',
  'cliente que não é dono do job não consegue preparar cobrança dele'
);

-- CPF/CNPJ do cliente: mesma coleta única do lado do profissional.
select is(
  public.obter_cpf_cnpj_cliente('f0000000-0000-0000-0000-000000000001'),
  null,
  'cliente sem documento cadastrado devolve null'
);
select lives_ok(
  $$select public.definir_cpf_cnpj_cliente('f0000000-0000-0000-0000-000000000001', '11122233344')$$,
  'documento é salvo na primeira vez'
);
select is(
  public.obter_cpf_cnpj_cliente('f0000000-0000-0000-0000-000000000001'),
  '11122233344',
  'documento salvo é lido de volta'
);

select * from finish();
rollback;
