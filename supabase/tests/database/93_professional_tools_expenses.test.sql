begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.professional_tools'::regclass),
  'inventário de ferramentas tem RLS habilitada'
);

select ok(
  not has_function_privilege('authenticated', 'public.link_professional_tool_expense()', 'EXECUTE'),
  'função de trigger não fica exposta como RPC'
);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('93000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tools-pro1@teste.local','',now(),now()),
('93000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tools-pro2@teste.local','',now(),now());

update public.profiles set role='profissional' where id in (
  '93000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000002'
);
insert into public.professionals(id,tipo,cidade,estado,subscription_plan_id) values
('93000000-0000-0000-0000-000000000001','autonomo','São Paulo','SP',(select id from public.subscription_plans where slug = 'master')),
('93000000-0000-0000-0000-000000000002','autonomo','Campinas','SP',(select id from public.subscription_plans where slug = 'master'));

set local role authenticated;
select set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000001',true);

insert into public.professional_tools(id,professional_id,name,category,acquired_on)
values ('93000000-0000-0000-0000-000000000010','93000000-0000-0000-0000-000000000001','Multímetro','eletrica','2026-08-10');

select is(
  (select count(*)::integer from public.expenses),
  0,
  'ferramenta sem valor não cria despesa'
);

insert into public.professional_tools(
  id,professional_id,expense_id,name,category,brand,purchase_price,acquired_on
) values (
  '93000000-0000-0000-0000-000000000011',
  '93000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000099',
  'Bomba de vácuo',
  'refrigeracao',
  'Suryha',
  1890.50,
  '2026-08-11'
);

select is(
  (select count(*)::integer from public.expenses where categoria='ferramenta' and valor=1890.50 and data='2026-08-11'),
  1,
  'valor informado cria exatamente uma despesa de ferramenta'
);

select ok(
  exists (
    select 1
      from public.professional_tools t
      join public.expenses e on e.id=t.expense_id
     where t.id='93000000-0000-0000-0000-000000000011'
       and e.professional_id=t.professional_id
       and e.descricao='Compra de ferramenta: Bomba de vácuo'
  ),
  'trigger ignora expense_id arbitrário e cria vínculo próprio consistente'
);

select set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000002',true);
select is(
  (select count(*)::integer from public.professional_tools),
  0,
  'outro profissional não enxerga o inventário'
);

delete from public.professional_tools where id='93000000-0000-0000-0000-000000000011';
select set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000001',true);
select is(
  (select count(*)::integer from public.professional_tools),
  2,
  'outro profissional não consegue apagar ferramenta alheia'
);

delete from public.expenses
where id=(select expense_id from public.professional_tools where id='93000000-0000-0000-0000-000000000011');
select ok(
  exists (
    select 1 from public.professional_tools
     where id='93000000-0000-0000-0000-000000000011' and expense_id is null
  ),
  'apagar a despesa preserva a ferramenta e apenas limpa o vínculo'
);

insert into public.professional_tools(id,professional_id,name,category,purchase_price,acquired_on)
values ('93000000-0000-0000-0000-000000000012','93000000-0000-0000-0000-000000000001','Manifold','diagnostico',650,'2026-08-12');
delete from public.professional_tools where id='93000000-0000-0000-0000-000000000012';
select is(
  (select count(*)::integer from public.expenses where descricao='Compra de ferramenta: Manifold'),
  1,
  'apagar a ferramenta preserva a despesa histórica'
);

insert into public.expenses(professional_id,categoria,descricao,valor,data)
values ('93000000-0000-0000-0000-000000000001','locacao','Aluguel de andaime',180,'2026-08-13');
select is(
  (select count(*)::integer from public.expenses where categoria='locacao'),
  1,
  'locação de ferramenta é aceita como categoria financeira própria'
);

select * from finish();
rollback;
