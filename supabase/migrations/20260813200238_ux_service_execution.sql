-- Fase UX 3 — execução assistida e relatório técnico versionado.

create table public.service_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  version integer not null check (version > 0),
  job_type text not null,
  title text not null check (char_length(title) between 3 and 120),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (code, version)
);

insert into public.service_checklist_templates (code, version, job_type, title, items) values
('instalacao_padrao', 1, 'instalacao', 'Instalação segura', '[{"key":"local","label":"Local e fixação conferidos"},{"key":"eletrica","label":"Alimentação elétrica conferida"},{"key":"dreno","label":"Dreno testado"},{"key":"vacuometro","label":"Vácuo e estanqueidade conferidos"},{"key":"teste","label":"Teste funcional realizado"}]'),
('manutencao_padrao', 1, 'manutencao', 'Manutenção preventiva', '[{"key":"protecao","label":"Área protegida"},{"key":"filtros","label":"Filtros higienizados"},{"key":"serpentina","label":"Serpentina inspecionada"},{"key":"dreno","label":"Dreno desobstruído/testado"},{"key":"teste","label":"Teste funcional realizado"}]'),
('visita_padrao', 1, 'outro', 'Atendimento técnico', '[{"key":"diagnostico","label":"Diagnóstico registrado"},{"key":"seguranca","label":"Condições de segurança verificadas"},{"key":"teste","label":"Teste funcional realizado"},{"key":"orientacao","label":"Cliente orientado"}]');

create table public.service_executions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id) on delete restrict,
  professional_id uuid not null references public.professionals(id) on delete restrict,
  template_id uuid not null references public.service_checklist_templates(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','finalized')),
  checklist jsonb not null default '{}' check (jsonb_typeof(checklist) = 'object'),
  materials jsonb not null default '[]' check (jsonb_typeof(materials) = 'array'),
  measurements jsonb not null default '{}' check (jsonb_typeof(measurements) = 'object'),
  evidence_paths text[] not null default '{}',
  notes text check (notes is null or char_length(notes) <= 4000),
  warranty_until date,
  maintenance_due date,
  started_at timestamptz not null default now(),
  finalized_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.service_reports (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references public.service_executions(id) on delete restrict,
  version integer not null check (version > 0),
  snapshot jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (execution_id, version)
);

alter table public.service_checklist_templates enable row level security;
alter table public.service_executions enable row level security;
alter table public.service_reports enable row level security;
create policy "templates_authenticated_read" on public.service_checklist_templates for select to authenticated using (true);
create policy "executions_participant_read" on public.service_executions for select to authenticated using (
  professional_id = (select auth.uid()) or exists (select 1 from public.jobs j where j.id = job_id and j.cliente_id = (select auth.uid())) or (select public.eh_admin())
);
create policy "reports_participant_read" on public.service_reports for select to authenticated using (
  exists (select 1 from public.service_executions e join public.jobs j on j.id=e.job_id where e.id=execution_id and (e.professional_id=(select auth.uid()) or j.cliente_id=(select auth.uid()) or (select public.eh_admin())))
);
grant select on public.service_checklist_templates, public.service_executions, public.service_reports to authenticated;
revoke insert, update, delete on public.service_checklist_templates, public.service_executions, public.service_reports from anon, authenticated;
create trigger trg_service_executions_touch before update on public.service_executions for each row execute function public.touch_updated_at();
create trigger trg_service_reports_immutable before update or delete on public.service_reports for each row execute function public.bloqueia_follow_up_evento();

create or replace function public.salvar_execucao_servico(
  p_job_id uuid, p_checklist jsonb, p_materials jsonb, p_measurements jsonb,
  p_evidence_paths text[], p_notes text, p_warranty_until date, p_maintenance_due date
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_uid uuid := (select auth.uid()); v_template uuid; v_id uuid; v_job_type text;
begin
  select job_type into v_job_type from public.jobs where id=p_job_id and profissional_id=v_uid and status in ('aguardando_profissional','aceito','em_execucao','concluido');
  if not found then raise exception 'Serviço indisponível para execução.'; end if;
  if jsonb_typeof(coalesce(p_checklist,'{}')) <> 'object' or jsonb_typeof(coalesce(p_materials,'[]')) <> 'array' or jsonb_typeof(coalesce(p_measurements,'{}')) <> 'object' then raise exception 'Dados técnicos inválidos.'; end if;
  if char_length(coalesce(p_notes,'')) > 4000 or coalesce(array_length(p_evidence_paths,1),0) > 20 then raise exception 'Limite do relatório excedido.'; end if;
  select id into v_template from public.service_checklist_templates where active and job_type=v_job_type order by version desc limit 1;
  if v_template is null then select id into v_template from public.service_checklist_templates where active and job_type='outro' order by version desc limit 1; end if;
  insert into public.service_executions(job_id,professional_id,template_id,checklist,materials,measurements,evidence_paths,notes,warranty_until,maintenance_due)
  values(p_job_id,v_uid,v_template,coalesce(p_checklist,'{}'),coalesce(p_materials,'[]'),coalesce(p_measurements,'{}'),coalesce(p_evidence_paths,'{}'),nullif(btrim(coalesce(p_notes,'')),''),p_warranty_until,p_maintenance_due)
  on conflict(job_id) do update set checklist=excluded.checklist,materials=excluded.materials,measurements=excluded.measurements,evidence_paths=excluded.evidence_paths,notes=excluded.notes,warranty_until=excluded.warranty_until,maintenance_due=excluded.maintenance_due
  where service_executions.professional_id=v_uid and service_executions.status='draft'
  returning id into v_id;
  if v_id is null then raise exception 'Relatório finalizado não pode ser alterado.'; end if;
  return v_id;
end $$;

create or replace function public.finalizar_execucao_servico(p_job_id uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare v_uid uuid := (select auth.uid()); v_execution public.service_executions%rowtype; v_report uuid;
begin
  select * into v_execution from public.service_executions where job_id=p_job_id and professional_id=v_uid and status='draft' for update;
  if not found then raise exception 'Rascunho não encontrado.'; end if;
  if not exists (select 1 from jsonb_each_text(v_execution.checklist) x where x.value='true') then raise exception 'Preencha o checklist antes de finalizar.'; end if;
  insert into public.service_reports(execution_id,version,snapshot,created_by) values(v_execution.id,1,to_jsonb(v_execution),v_uid) returning id into v_report;
  update public.service_executions set status='finalized',finalized_at=now() where id=v_execution.id;
  return v_report;
end $$;

revoke all on function public.salvar_execucao_servico(uuid,jsonb,jsonb,jsonb,text[],text,date,date) from public,anon;
revoke all on function public.finalizar_execucao_servico(uuid) from public,anon;
grant execute on function public.salvar_execucao_servico(uuid,jsonb,jsonb,jsonb,text[],text,date,date), public.finalizar_execucao_servico(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('service-evidence','service-evidence',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']) on conflict(id) do nothing;
create policy "service_evidence_owner_insert" on storage.objects for insert to authenticated with check (bucket_id='service-evidence' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "service_evidence_participant_read" on storage.objects for select to authenticated using (bucket_id='service-evidence' and ((storage.foldername(name))[1]=(select auth.uid())::text or exists(select 1 from public.jobs j where j.id::text=(storage.foldername(name))[2] and j.cliente_id=(select auth.uid()))));
