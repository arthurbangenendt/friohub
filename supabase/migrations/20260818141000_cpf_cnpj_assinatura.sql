-- ============================================================================
-- CPF/CNPJ do profissional — necessário para abrir um customer no Asaas
-- ============================================================================
--
-- `professionals.cnpj` só é preenchido para tipo = 'empresa'. Autônomo nunca
-- teve nenhum documento fiscal no schema porque nada até agora precisava.
-- Cobrar exige: o Asaas recusa `POST /customers` sem `cpfCnpj`.
--
-- Coleta é just-in-time (no momento de assinar, não no cadastro): pedir CPF
-- de quem nunca vai pagar nada é fricção sem propósito.

alter table public.professionals
  add column if not exists cpf_cnpj text;

-- Só dígitos, 11 (CPF) ou 14 (CNPJ). Validação de dígito verificador fica a
-- cargo do Asaas — a API já recusa documento inválido na criação do customer.
alter table public.professionals
  add constraint professionals_cpf_cnpj_formato
  check (cpf_cnpj is null or cpf_cnpj ~ '^[0-9]{11}$|^[0-9]{14}$');

comment on column public.professionals.cpf_cnpj is
  'Documento fiscal para o gateway de pagamento (Asaas). Coletado just-in-time ao assinar um plano, não no cadastro.';
