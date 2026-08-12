-- [RISCO 2] O profissional só consegue INSERIR um destaque (patrocinado) se passar
-- na trava de qualidade — verificado, nota e histórico mínimos. Enforçado no banco.
drop policy if exists "featured_owner_insert" on public.featured_placements;
create policy "featured_owner_insert" on public.featured_placements for insert
  with check (
    professional_id = auth.uid()
    and public.is_featured_eligible(professional_id, specialty)
  );
