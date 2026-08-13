-- ============================================================================
-- PLAN_INTEREST — leitura para o admin
-- ============================================================================
--
-- A política criada em 20260813190000 deixa cada profissional ler apenas o
-- próprio registro (`professional_id = auth.uid()`). Correto para o parceiro e
-- errado para a operação: o número que decide se vale construir a cobrança é
-- justamente o agregado, e ninguém conseguia vê-lo.
--
-- `eh_admin()` é SECURITY DEFINER (ver 20260812230000_chat.sql) — lê `profiles`
-- por fora da RLS e por isso não causa recursão quando usada dentro de uma
-- policy. É o mesmo mecanismo usado pelas demais tabelas administradas.
--
-- Continua sem política de INSERT/UPDATE/DELETE para qualquer papel: a escrita
-- é exclusiva do RPC `registrar_interesse_plano`, que é SECURITY DEFINER e
-- valida papel e plano. Admin lê, não fabrica interesse.

drop policy if exists "plan_interest_admin_read" on public.plan_interest;
create policy "plan_interest_admin_read" on public.plan_interest
  for select using ((select public.eh_admin()));

comment on policy "plan_interest_admin_read" on public.plan_interest is
  'Admin lê todos os registros de interesse para medir demanda por plano.';
