-- ============================================================================
-- Storage para o portfólio dos profissionais (fotos).
-- Arquivos ficam em portfolio/{uid}/{arquivo}. Leitura pública; escrita só do dono.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('portfolio', 'portfolio', true)
on conflict (id) do nothing;

-- Leitura pública das imagens do bucket
drop policy if exists "portfolio_public_read" on storage.objects;
create policy "portfolio_public_read" on storage.objects
  for select using (bucket_id = 'portfolio');

-- O profissional só envia dentro da própria pasta (primeiro segmento = uid)
drop policy if exists "portfolio_owner_insert" on storage.objects;
create policy "portfolio_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'portfolio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "portfolio_owner_delete" on storage.objects;
create policy "portfolio_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'portfolio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
