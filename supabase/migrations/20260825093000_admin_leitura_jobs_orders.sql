-- ============================================================================
-- Admin lê `jobs` e `orders` para suporte
-- ============================================================================
--
-- `job_events`, `job_appointments`, `quote_request_events` e `quotes` (via
-- `quotes_pro_read`) já seguem o padrão "participante OU eh_admin()" — mas as
-- duas tabelas mais antigas do domínio, `jobs` e `orders`, nasceram no
-- `init.sql` antes desse padrão existir e nunca foram retrofitadas. Resultado:
-- `/servico/[id]` não tinha como mostrar nada a um admin mesmo depois de
-- corrigido o redirect de aplicação, porque a policy de SELECT já bloqueava a
-- consulta antes de chegar em qualquer checagem de papel.
--
-- Leitura, não escrita — SECURITY_PERMISSION_MATRIX.md já promete isso
-- ("Job ... Admin: Ler para suporte", "Order ... Admin: Ler completa").

create policy "jobs_admin_read" on public.jobs for select
  to authenticated
  using ((select public.eh_admin()));

create policy "orders_admin_read" on public.orders for select
  to authenticated
  using ((select public.eh_admin()));
