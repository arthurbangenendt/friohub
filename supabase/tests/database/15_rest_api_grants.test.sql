begin;
select plan(19);

select ok(has_table_privilege('anon','public.profiles','SELECT'),'anônimo alcança perfis sob RLS');
select ok(has_column_privilege('anon','public.professionals','bio','SELECT'),'anônimo lê bio pública');
select ok(not has_column_privilege('anon','public.professionals','cnpj','SELECT'),'CNPJ profissional não é público');
select ok(has_table_privilege('authenticated','public.profile_private','SELECT'),'autenticado alcança dado privado sob RLS');
select ok(has_table_privilege('authenticated','public.profiles','UPDATE'),'dono pode editar perfil sob RLS e trigger');
select ok(has_table_privilege('authenticated','public.professionals','INSERT'),'profissional pode concluir onboarding');
select ok(has_table_privilege('authenticated','public.jobs','SELECT'),'participante alcança jobs sob RLS');
select ok(has_table_privilege('authenticated','public.jobs','UPDATE'),'participante usa transições protegidas');
select ok(has_table_privilege('authenticated','public.messages','INSERT'),'participante envia mensagem sob RLS');
select ok(has_table_privilege('authenticated','public.quote_requests','INSERT'),'cliente cria pedido sob RLS');
select ok(has_table_privilege('authenticated','public.quotes','INSERT'),'profissional cria proposta sob RLS');
select ok(has_table_privilege('authenticated','public.products','UPDATE'),'distribuidora atualiza catálogo sob trigger');
select ok(has_column_privilege('authenticated','public.platform_config','id','SELECT'),'trigger de markup alcança chave da configuração');
select ok(has_table_privilege('authenticated','public.purchase_orders','SELECT'),'distribuidora lê repasse sob RLS');
select ok(not has_table_privilege('authenticated','public.purchase_orders','UPDATE'),'repasse não aceita update genérico');
select ok(not has_table_privilege('authenticated','public.orders','INSERT'),'order nasce apenas no fluxo financeiro');
select ok(not has_table_privilege('authenticated','public.admin_audit_log','INSERT'),'auditoria não aceita insert genérico');
select ok(not has_table_privilege('authenticated','public.service_executions','UPDATE'),'execução escreve somente por RPC');
select ok(not has_column_privilege('authenticated','public.products','custo','SELECT'),'custo segue fora do catálogo genérico');

select * from finish();
rollback;
