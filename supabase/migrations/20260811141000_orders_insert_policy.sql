-- Permite ao dono do job criar a ordem correspondente (faltava no schema inicial).
drop policy if exists "orders_owner_insert" on public.orders;
create policy "orders_owner_insert" on public.orders for insert
  with check (
    exists (
      select 1 from public.jobs j
      where j.id = job_id and j.cliente_id = auth.uid()
    )
  );
