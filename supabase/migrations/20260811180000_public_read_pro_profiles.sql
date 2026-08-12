-- Visitantes anônimos precisam ver o NOME dos profissionais (home, página pública
-- do profissional). Mas o perfil de CLIENTE deve continuar privado.
-- Liberamos leitura pública apenas dos profiles que pertencem a um professional.
drop policy if exists "profiles_read_professionals" on public.profiles;
create policy "profiles_read_professionals" on public.profiles
  for select using (
    exists (select 1 from public.professionals pr where pr.id = profiles.id)
  );
