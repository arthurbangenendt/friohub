-- ============================================================================
-- Avatar e banner do perfil.
--
-- O avatar reusa `profiles.avatar_url`, que já existia desde o init e nunca foi
-- lido nem escrito por nenhuma tela — coluna morta até agora.
--
-- O banner é só do profissional: é a faixa de apresentação do perfil público,
-- que o cliente vê antes de contratar. Cliente não tem banner.
-- ============================================================================
alter table public.professionals
  add column if not exists banner_url text;

-- ----------------------------------------------------------------------------
-- Bucket próprio para mídia de perfil.
--
-- Separado do bucket `portfolio` de propósito: avatar e banner são 1:1 e
-- substituíveis, o portfólio é coleção. No mesmo bucket, arquivo de avatar
-- ficaria convivendo com foto de trabalho na mesma pasta do profissional.
--
-- Policies espelham as de 20260811170000_portfolio_storage: leitura pública
-- (a imagem aparece no perfil público, inclusive para visitante anônimo),
-- escrita e remoção restritas à pasta {uid}/ do próprio dono.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('perfil', 'perfil', true)
on conflict (id) do nothing;

drop policy if exists "perfil_public_read" on storage.objects;
create policy "perfil_public_read" on storage.objects
  for select using (bucket_id = 'perfil');

drop policy if exists "perfil_owner_insert" on storage.objects;
create policy "perfil_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'perfil'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "perfil_owner_update" on storage.objects;
create policy "perfil_owner_update" on storage.objects
  for update using (
    bucket_id = 'perfil'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "perfil_owner_delete" on storage.objects;
create policy "perfil_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'perfil'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
