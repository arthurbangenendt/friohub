-- ============================================================================
-- Despesas da distribuidora.
--
-- Espelha public.expenses (20260812190000_despesas.sql), mas com categorias de
-- operação de armazém/distribuição em vez das de campo do técnico. Sem isso a
-- distribuidora só tem faturamento rastreado (custo_snapshot recebido) e não
-- dá pra calcular lucro real dela — só o admin financeiro (fase seguinte)
-- depende dessa tabela pra mostrar "quanto sobrou" e não só "quanto entrou".
--
-- Fica ligada opcionalmente a um purchase_order: dá pra ver o custo de UM
-- repasse (quanto sobrou naquele pedido) e também o custo do mês inteiro.
-- ============================================================================
create table if not exists public.distributor_expenses (
  id                uuid primary key default gen_random_uuid(),
  distributor_id    uuid not null references public.distributors (id) on delete cascade,
  purchase_order_id uuid references public.purchase_orders (id) on delete set null,
  categoria         text not null default 'outros'
                    check (categoria in ('frete', 'armazenagem', 'terceiros', 'imposto', 'outros')),
  descricao         text,
  valor             numeric(10,2) not null check (valor >= 0),
  data              date not null default current_date,
  created_at        timestamptz not null default now()
);

create index if not exists idx_distributor_expenses_dist_data on public.distributor_expenses (distributor_id, data desc);
create index if not exists idx_distributor_expenses_po on public.distributor_expenses (purchase_order_id);

alter table public.distributor_expenses enable row level security;

-- Despesa é dado financeiro privado: só a dona enxerga e escreve. Admin lê
-- para o financeiro consolidado (ver 20260904110000_expenses_admin_read.sql,
-- mesmo padrão), nunca escreve por conta de terceiro.
drop policy if exists "distributor_expenses_owner_all" on public.distributor_expenses;
create policy "distributor_expenses_owner_all" on public.distributor_expenses for all
  using (auth.uid() = distributor_id)
  with check (auth.uid() = distributor_id);

drop policy if exists "distributor_expenses_admin_read" on public.distributor_expenses;
create policy "distributor_expenses_admin_read" on public.distributor_expenses for select
  using (public.eh_admin());

-- RLS só filtra linhas depois que o papel tem privilégio SQL na tabela — uma
-- tabela nova não herda isso, é allowlist explícita (mesmo modelo de
-- 20260814114010_rest_api_role_grants.sql, que grantou exatamente isto para
-- `expenses`: select/insert/delete, sem update — a UI só registra e remove).
grant select, insert, delete on public.distributor_expenses to authenticated;

comment on table public.distributor_expenses is
  'Despesas da distribuidora. Privado à dona, exceto leitura por admin — nunca exposto a técnico ou cliente.';
