-- Admin pode atualizar qualquer profissional (para aprovar/rejeitar verificação).
drop policy if exists "prof_admin_update" on public.professionals;
create policy "prof_admin_update" on public.professionals for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Bootstrap: promove a conta do dono a admin (se já existir em auth.users).
update public.profiles set role = 'admin'
where id in (select id from auth.users where email = 'arthur.b.angenend@gmail.com');
