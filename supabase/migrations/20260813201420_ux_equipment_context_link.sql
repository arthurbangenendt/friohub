-- Mantém o contexto do patrimônio quando o pedido recorrente vira serviço.
create or replace function public.vincula_equipamento_do_pedido() returns trigger language plpgsql security definer set search_path=public as $$
declare v_equipment uuid;
begin
 if new.quote_request_id is null then return new; end if;
 select nullif(q.detalhes->>'equipment_id','')::uuid into v_equipment from public.quote_requests q where q.id=new.quote_request_id;
 if v_equipment is not null and exists(select 1 from public.customer_equipment e where e.id=v_equipment and e.customer_id=new.cliente_id) then
   insert into public.equipment_service_links(equipment_id,job_id) values(v_equipment,new.id) on conflict do nothing;
 end if; return new;
end $$;
revoke all on function public.vincula_equipamento_do_pedido() from public,anon,authenticated;
create trigger trg_jobs_link_equipment after insert on public.jobs for each row execute function public.vincula_equipamento_do_pedido();

create table public.equipment_pmoc_links(
 equipment_id uuid not null references public.customer_equipment(id) on delete restrict,
 plan_id uuid not null references public.pmoc_plans(id) on delete restrict,
 linked_at timestamptz not null default now(), primary key(equipment_id,plan_id)
);
alter table public.equipment_pmoc_links enable row level security;
create policy "equipment_pmoc_participant_read" on public.equipment_pmoc_links for select to authenticated using(exists(select 1 from public.pmoc_plans p where p.id=plan_id and (p.client_id=(select auth.uid()) or p.professional_id=(select auth.uid()) or (select public.eh_admin()))));
grant select on public.equipment_pmoc_links to authenticated; revoke insert,update,delete on public.equipment_pmoc_links from authenticated;
create or replace function public.vincular_equipamento_pmoc(p_equipment_id uuid,p_plan_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.customer_equipment e join public.pmoc_plans p on p.client_id=e.customer_id where e.id=p_equipment_id and p.id=p_plan_id and (p.client_id=(select auth.uid()) or p.professional_id=(select auth.uid()))) then raise exception 'Equipamento e PMOC incompatíveis.'; end if;
 insert into public.equipment_pmoc_links(equipment_id,plan_id) values(p_equipment_id,p_plan_id) on conflict do nothing;
end $$;
revoke all on function public.vincular_equipamento_pmoc(uuid,uuid) from public,anon; grant execute on function public.vincular_equipamento_pmoc(uuid,uuid) to authenticated;
