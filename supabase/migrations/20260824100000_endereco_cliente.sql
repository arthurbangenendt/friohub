-- ============================================================================
-- Endereço salvo no perfil do cliente
-- ============================================================================
--
-- Mesma tabela/RLS que já protege telefone e cpf_cnpj (profile_private,
-- 20260812120000) — dono lê/escreve, admin só lê. Usado pra pré-preencher o
-- CEP em /solicitar e o endereço completo na hora de aceitar uma proposta
-- (`enderecoSugerido`, hoje sempre string vazia).

alter table public.profile_private
  add column if not exists endereco_cep text,
  add column if not exists endereco_bairro text,
  add column if not exists endereco_completo text;
