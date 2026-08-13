-- Fase UX 5 — metas privadas; resultados continuam derivados do ledger real.
create table public.professional_goals (
 id uuid primary key default gen_random_uuid(), professional_id uuid not null references public.professionals(id) on delete restrict,
 month date not null check(month=date_trunc('month',month)::date), revenue_target numeric(12,2) not null check(revenue_target>0 and revenue_target<=10000000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(professional_id,month)
);
alter table public.professional_goals enable row level security;
create policy "goals_owner" on public.professional_goals for all to authenticated using(professional_id=(select auth.uid()) or (select public.eh_admin())) with check(professional_id=(select auth.uid()));
grant select,insert,update on public.professional_goals to authenticated; revoke delete on public.professional_goals from authenticated;
create trigger trg_professional_goals_touch before update on public.professional_goals for each row execute function public.touch_updated_at();
