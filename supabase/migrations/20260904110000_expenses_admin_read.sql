-- ============================================================================
-- Admin lê despesas do profissional (financeiro consolidado por técnico).
--
-- `expenses` só tinha policy de dono (expenses_owner_all, for all). Sem uma
-- policy de SELECT pra admin, a tela admin/profissionais/[id]/financeiro não
-- consegue calcular o resultado líquido do técnico (bruto - comissão -
-- despesas) — só veria as despesas dele com service_role.
--
-- Mesmo padrão de jobs_admin_read/orders_admin_read
-- (20260825093000_admin_leitura_jobs_orders.sql): policy nova de SELECT,
-- somada por OR à policy existente do mesmo comando — amplia só leitura,
-- nunca dá insert/update/delete de despesa de terceiro.
-- ============================================================================
drop policy if exists "expenses_admin_read" on public.expenses;
create policy "expenses_admin_read" on public.expenses for select
  using (public.eh_admin());
