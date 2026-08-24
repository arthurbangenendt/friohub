-- ============================================================================
-- Upload de documento pra dar lastro real ao selo "verificado"
-- ============================================================================
--
-- Hoje a verificação é 100% textual — admin lê bio/cidade/skills
-- autodeclaradas, sem nenhum documento anexado. Bucket privado desde o
-- início, mesmo molde de `orcamentos` (20260813153000_private_quote_photos):
-- dono grava, dono + admin leem via função security definer, nunca via URL
-- pública.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos-verificacao', 'documentos-verificacao', false, 10485760,
        array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;

create policy "documentos_verificacao_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documentos-verificacao' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "documentos_verificacao_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documentos-verificacao' and (storage.foldername(name))[1] = (select auth.uid())::text);

create or replace function public.pode_ler_documento_verificacao(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (storage.foldername(p_storage_path))[1] = (select auth.uid())::text
      or (select public.eh_admin());
$$;

revoke all on function public.pode_ler_documento_verificacao(text) from public, anon;
grant execute on function public.pode_ler_documento_verificacao(text) to authenticated;

create policy "documentos_verificacao_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'documentos-verificacao' and public.pode_ler_documento_verificacao(name));

alter table public.professionals
  add column if not exists documento_tipo text check (documento_tipo in ('cnh', 'rg', 'crea_cft', 'cartao_cnpj')),
  add column if not exists documento_storage_path text,
  add column if not exists documento_enviado_em timestamptz;

-- Mesma trava de material change já aplicada a bio/cidade/skills: trocar o
-- documento de quem já está verificado manda de volta pra análise.
create or replace function public.protege_confianca_professional()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.eh_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.verification_status  := 'em_analise';
    new.verified_at          := null;
    new.subscription_status  := 'gratis';
    new.subscription_plan_id := null;
  else
    new.subscription_status  := old.subscription_status;
    new.subscription_plan_id := old.subscription_plan_id;

    if old.verification_status = 'verificado' and (
      new.tipo is distinct from old.tipo
      or new.razao_social is distinct from old.razao_social
      or new.bio is distinct from old.bio
      or new.cidade is distinct from old.cidade
      or new.estado is distinct from old.estado
      or new.anos_experiencia is distinct from old.anos_experiencia
      or new.documento_storage_path is distinct from old.documento_storage_path
      or new.documento_tipo is distinct from old.documento_tipo
    ) then
      new.verification_status := 'em_analise';
      new.verified_at := null;
    else
      new.verification_status := old.verification_status;
      new.verified_at := old.verified_at;
    end if;
  end if;
  return new;
end;
$$;
