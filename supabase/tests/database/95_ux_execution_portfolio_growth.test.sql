begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(28);

select has_table('public','service_checklist_templates','templates versionados existem');
select has_table('public','service_executions','rascunhos de execução existem');
select has_table('public','service_reports','relatórios versionados existem');
select has_table('public','customer_sites','locais do cliente existem');
select has_table('public','customer_equipment','equipamentos existem');
select has_table('public','equipment_service_links','vínculo serviço/equipamento existe');
select has_table('public','equipment_pmoc_links','vínculo PMOC/equipamento existe');
select has_table('public','professional_client_notes','notas privadas existem');
select has_table('public','maintenance_recommendations','recomendações existem');
select has_table('public','professional_goals','metas privadas existem');

select has_function('public','salvar_execucao_servico',array['uuid','jsonb','jsonb','jsonb','text[]','text','date','date'],'execução usa RPC');
select has_function('public','finalizar_execucao_servico',array['uuid'],'finalização usa RPC');
select has_function('public','recomendar_manutencao',array['uuid','date','text'],'recomendação usa RPC');
select has_function('public','vincular_equipamento_pmoc',array['uuid','uuid'],'vínculo PMOC usa RPC');

select ok(not has_table_privilege('authenticated','public.service_executions','INSERT'),'execução não aceita insert direto');
select ok(not has_table_privilege('authenticated','public.service_executions','UPDATE'),'execução não aceita update direto');
select ok(not has_table_privilege('authenticated','public.service_reports','INSERT'),'relatório não aceita insert direto');
select ok(not has_table_privilege('authenticated','public.service_reports','UPDATE'),'relatório não aceita update direto');
select ok(not has_table_privilege('authenticated','public.maintenance_recommendations','INSERT'),'recomendação não aceita insert direto');
select ok(not has_table_privilege('authenticated','public.equipment_service_links','INSERT'),'vínculo serviço não aceita insert direto');
select ok(not has_table_privilege('authenticated','public.equipment_pmoc_links','INSERT'),'vínculo PMOC não aceita insert direto');

select ok(not has_table_privilege('anon','public.service_executions','SELECT'),'anônimo não lê execução');
select ok(not has_table_privilege('anon','public.service_reports','SELECT'),'anônimo não lê relatório');
select ok(not has_table_privilege('anon','public.customer_equipment','SELECT'),'anônimo não lê patrimônio');
select ok(not has_table_privilege('anon','public.professional_client_notes','SELECT'),'anônimo não lê notas');
select ok(not has_table_privilege('anon','public.professional_goals','SELECT'),'anônimo não lê metas');
select is((select count(*)::integer from public.service_checklist_templates where active),3,'templates iniciais ativos');
select is((select public from storage.buckets where id='service-evidence'),false,'bucket de evidência é privado');

select * from finish();
rollback;
