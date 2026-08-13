-- Fase UX 4 — patrimônio do cliente, carteira profissional e recorrência consentida.
create table public.customer_sites (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id) on delete restrict,
 label text not null check(char_length(label) between 2 and 100), address text not null check(char_length(address) between 5 and 300), cep text,
 created_at timestamptz not null default now()
);
create table public.customer_equipment (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id) on delete restrict,
 site_id uuid references public.customer_sites(id) on delete restrict, kind text not null default 'ar_condicionado', brand text, model text, serial_number text,
 capacity_btu integer check(capacity_btu is null or capacity_btu between 1000 and 200000), installed_at date, notes text check(notes is null or char_length(notes)<=2000), created_at timestamptz not null default now()
);
create table public.equipment_service_links (
 equipment_id uuid not null references public.customer_equipment(id) on delete restrict, job_id uuid not null unique references public.jobs(id) on delete restrict,
 linked_at timestamptz not null default now(), primary key(equipment_id,job_id)
);
create table public.professional_client_notes (
 id uuid primary key default gen_random_uuid(), professional_id uuid not null references public.professionals(id) on delete restrict,
 customer_id uuid not null references public.profiles(id) on delete restrict, notes text not null check(char_length(notes) between 1 and 4000), updated_at timestamptz not null default now(), unique(professional_id,customer_id)
);
create table public.maintenance_recommendations (
 id uuid primary key default gen_random_uuid(), equipment_id uuid not null references public.customer_equipment(id) on delete restrict,
 professional_id uuid not null references public.professionals(id) on delete restrict, due_on date not null, reason text not null check(char_length(reason) between 2 and 500),
 reminder_consent boolean not null default false, status text not null default 'recommended' check(status in ('recommended','scheduled','completed','dismissed')), created_at timestamptz not null default now()
);
alter table public.customer_sites enable row level security; alter table public.customer_equipment enable row level security; alter table public.equipment_service_links enable row level security; alter table public.professional_client_notes enable row level security; alter table public.maintenance_recommendations enable row level security;
create policy "sites_owner" on public.customer_sites for all to authenticated using(customer_id=(select auth.uid()) or (select public.eh_admin())) with check(customer_id=(select auth.uid()));
create policy "equipment_owner" on public.customer_equipment for all to authenticated using(customer_id=(select auth.uid()) or (select public.eh_admin())) with check(customer_id=(select auth.uid()) and (site_id is null or exists(select 1 from public.customer_sites s where s.id=site_id and s.customer_id=(select auth.uid()))));
create policy "equipment_professional_read" on public.customer_equipment for select to authenticated using(exists(select 1 from public.jobs j where j.cliente_id=customer_id and j.profissional_id=(select auth.uid())));
create policy "links_participant_read" on public.equipment_service_links for select to authenticated using(exists(select 1 from public.jobs j where j.id=job_id and (j.cliente_id=(select auth.uid()) or j.profissional_id=(select auth.uid()) or (select public.eh_admin()))));
create policy "notes_professional" on public.professional_client_notes for all to authenticated using(professional_id=(select auth.uid()) or (select public.eh_admin())) with check(professional_id=(select auth.uid()) and exists(select 1 from public.jobs j where j.cliente_id=customer_id and j.profissional_id=(select auth.uid())));
create policy "maintenance_participant_read" on public.maintenance_recommendations for select to authenticated using(professional_id=(select auth.uid()) or exists(select 1 from public.customer_equipment e where e.id=equipment_id and e.customer_id=(select auth.uid())) or (select public.eh_admin()));
grant select,insert,update on public.customer_sites,public.customer_equipment to authenticated;
grant select on public.equipment_service_links,public.maintenance_recommendations to authenticated;
grant select,insert,update on public.professional_client_notes to authenticated;
revoke delete on public.customer_sites,public.customer_equipment,public.equipment_service_links,public.professional_client_notes,public.maintenance_recommendations from authenticated;
create index idx_equipment_customer on public.customer_equipment(customer_id,created_at desc); create index idx_notes_professional on public.professional_client_notes(professional_id,customer_id); create index idx_maintenance_due on public.maintenance_recommendations(due_on) where status='recommended';
create trigger trg_client_notes_touch before update on public.professional_client_notes for each row execute function public.touch_updated_at();

create or replace function public.recomendar_manutencao(p_equipment_id uuid,p_due_on date,p_reason text) returns uuid language plpgsql security definer set search_path=public as $$
declare v_uid uuid := (select auth.uid()); v_id uuid;
begin
 if p_due_on < current_date or char_length(btrim(coalesce(p_reason,''))) not between 2 and 500 then raise exception 'Recomendação inválida.'; end if;
 if not exists(select 1 from public.customer_equipment e join public.jobs j on j.cliente_id=e.customer_id where e.id=p_equipment_id and j.profissional_id=v_uid) then raise exception 'Acesso negado ao equipamento.'; end if;
 insert into public.maintenance_recommendations(equipment_id,professional_id,due_on,reason) values(p_equipment_id,v_uid,p_due_on,btrim(p_reason)) returning id into v_id; return v_id;
end $$;
revoke all on function public.recomendar_manutencao(uuid,date,text) from public,anon; grant execute on function public.recomendar_manutencao(uuid,date,text) to authenticated;
