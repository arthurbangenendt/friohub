-- ============================================================================
-- Chave PIX do profissional — pré-requisito do repasse automático (Melhoria 2)
--
-- Mesma classe de sigilo que `professionals.cpf_cnpj` (20260818141000): dado
-- financeiro do profissional, NUNCA pode entrar na allowlist de SELECT que
-- `20260814114010_rest_api_role_grants.sql` expõe para a vitrine pública —
-- `professionals` é lida por qualquer visitante. Por isso a coluna nasce sem
-- nenhum grant de SELECT, e o único acesso é via RPC own-row (mesmo padrão de
-- `meu_cpf_cnpj_professional` / `definir_cpf_cnpj_professional`).
--
-- Ao contrário do CPF/CNPJ (coleta única, ligada à identidade do pagador no
-- gateway), a chave PIX pode ser trocada a qualquer momento — é só o destino
-- do dinheiro, trocar de banco não é trocar de identidade fiscal.
-- ============================================================================

alter table public.professionals
  add column if not exists chave_pix text,
  add column if not exists chave_pix_tipo text
    check (chave_pix_tipo in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria'));

alter table public.professionals
  drop constraint if exists professionals_chave_pix_par;
alter table public.professionals
  add constraint professionals_chave_pix_par
  check ((chave_pix is null) = (chave_pix_tipo is null));

comment on column public.professionals.chave_pix is
  'Chave PIX de destino do repasse automático. Documento fiscal-adjacente: '
  'NUNCA entra em grant de SELECT a anon/authenticated — só via minha_chave_pix().';

create or replace function public.minha_chave_pix()
returns table (chave_pix text, chave_pix_tipo text)
language sql
security definer
stable
set search_path = public
as $$
  select chave_pix, chave_pix_tipo
    from public.professionals
   where id = (select auth.uid());
$$;

revoke all on function public.minha_chave_pix() from public, anon;
grant execute on function public.minha_chave_pix() to authenticated;

create or replace function public.salvar_chave_pix(p_chave text, p_tipo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_chave text := btrim(coalesce(p_chave, ''));
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;
  if p_tipo not in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria') then
    raise exception 'Tipo de chave PIX inválido.';
  end if;
  if v_chave = '' then
    raise exception 'Informe a chave PIX.';
  end if;
  if p_tipo in ('cpf', 'cnpj') and v_chave !~ '^[0-9]{11}$|^[0-9]{14}$' then
    raise exception 'CPF ou CNPJ inválido — use só números.';
  end if;

  update public.professionals
     set chave_pix = v_chave, chave_pix_tipo = p_tipo
   where id = v_uid;

  if not found then
    raise exception 'Perfil de profissional não encontrado.';
  end if;
end;
$$;

revoke all on function public.salvar_chave_pix(text, text) from public, anon;
grant execute on function public.salvar_chave_pix(text, text) to authenticated;

comment on function public.salvar_chave_pix(text, text) is
  'Profissional cadastra ou troca a própria chave PIX — destino do repasse automático de cada job concluído.';
