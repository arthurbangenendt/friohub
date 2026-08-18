-- ============================================================================
-- Correção: página /planos não conseguia ler professionals.cpf_cnpj
-- ============================================================================
--
-- 20260818141000 criou a coluna mas não deu GRANT nenhum de SELECT a
-- `authenticated` — e não podia dar o `grant select` genérico como fez para
-- as demais colunas em 20260814114010, porque `professionals` é lido em
-- vitrine pública (qualquer usuário pode ver o perfil de qualquer
-- profissional). CPF/CNPJ é documento fiscal: mesma classe de sigilo que
-- `professionals.cnpj`, que aquela migration já deixou de fora da allowlist
-- de propósito ("fica fora da allowlist mesmo quando a policy permite ler a
-- linha"). A saída é a mesma usada no lado do gateway: RPC que só devolve o
-- documento do próprio usuário, nunca de terceiros.

create or replace function public.meu_cpf_cnpj_professional()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select cpf_cnpj from public.professionals where id = (select auth.uid());
$$;

revoke all on function public.meu_cpf_cnpj_professional() from public, anon;
grant execute on function public.meu_cpf_cnpj_professional() to authenticated;
