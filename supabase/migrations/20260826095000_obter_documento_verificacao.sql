-- ============================================================================
-- Admin lê o caminho do documento de verificação
-- ============================================================================
--
-- Achado testando /admin/profissionais pela primeira vez de ponta a ponta:
-- "permission denied for table professionals" ao clicar em "Ver documento".
-- Causa raiz é anterior a esta sessão — `20260814114010_rest_api_role_grants`
-- já restringe `professionals` a um allowlist de colunas públicas (vitrine),
-- e `documento_storage_path`/`documento_tipo` nunca entraram nessa lista.
-- O fluxo de verificação de profissional (RISCO 4 — qualidade da rede) nunca
-- funcionou de ponta a ponta em produção por causa disso.
--
-- Correção NÃO é adicionar a coluna ao grant público: `documento_storage_path`
-- é o caminho de um documento de identidade/CNPJ — mesma sensibilidade que já
-- levou o arquivo em si a exigir RLS de storage dedicada
-- (`pode_ler_documento_verificacao`). Alargar o grant geral exporia o caminho
-- de QUALQUER profissional pra QUALQUER usuário autenticado, não só admin.
-- RPC restrita a eh_admin() é o mesmo padrão já usado em toda esta sessão pra
-- dado sensível que só o admin precisa ler.
--
-- `documento_tipo` fica de fora — nenhuma tela do admin usa esse campo hoje.

create or replace function public.obter_documento_verificacao(p_professional_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  if not (select public.eh_admin()) then
    raise exception 'Acesso restrito a administradores.';
  end if;

  select documento_storage_path into v_path
    from public.professionals
   where id = p_professional_id;

  return v_path;
end;
$$;

revoke all on function public.obter_documento_verificacao(uuid)
  from public, anon;
grant execute on function public.obter_documento_verificacao(uuid)
  to authenticated;

comment on function public.obter_documento_verificacao(uuid) is
  'Caminho do documento de verificação de um profissional, só para admin — documento_storage_path não está no grant público de professionals de propósito (mesma sensibilidade do arquivo em si).';
