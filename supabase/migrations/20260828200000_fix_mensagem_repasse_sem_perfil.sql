-- ============================================================================
-- Mensagem de erro mais clara quando a distribuidora tenta cadastrar Pix/TED
-- antes de salvar o perfil (razão social/CNPJ) — achado testando em produção
-- 28/08/2026: "Perfil de distribuidora não encontrado." não dizia o que
-- fazer. A causa é sempre a mesma: `distributors` só ganha linha quando
-- `salvar_perfil_distribuidora` roda pela primeira vez (é ela que faz o
-- INSERT); as duas RPCs de repasse só fazem UPDATE, então falham se a
-- distribuidora tentar a seção de repasse primeiro. A tela agora esconde
-- essa seção até o perfil existir (ConfigRepasseForm.tsx), mas a RPC
-- continua sendo a garantia de verdade — mensagem melhor pra quem chegar
-- aqui de outro jeito (API direta, corrida entre abas).
-- ============================================================================

create or replace function public.salvar_repasse_pix_distribuidora(p_chave text, p_tipo text)
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

  update public.distributors
     set metodo_repasse = 'pix',
         chave_pix = v_chave, chave_pix_tipo = p_tipo,
         banco_codigo = null, banco_agencia = null, banco_conta = null,
         banco_conta_digito = null, banco_conta_tipo = null,
         banco_titular_nome = null, banco_titular_documento = null
   where id = v_uid;

  if not found then
    raise exception 'Salve a razão social e o CNPJ no seu perfil primeiro — isso cria o seu cadastro de distribuidora.';
  end if;
end;
$$;

create or replace function public.salvar_repasse_bancario_distribuidora(
  p_banco_codigo text, p_agencia text, p_conta text, p_conta_digito text,
  p_conta_tipo text, p_titular_nome text, p_titular_documento text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_documento text := regexp_replace(coalesce(p_titular_documento, ''), '[^0-9]', '', 'g');
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;
  if p_conta_tipo not in ('conta_corrente', 'conta_poupanca') then
    raise exception 'Tipo de conta inválido.';
  end if;
  if nullif(btrim(coalesce(p_banco_codigo, '')), '') is null then
    raise exception 'Informe o código do banco.';
  end if;
  if nullif(btrim(coalesce(p_agencia, '')), '') is null then
    raise exception 'Informe a agência.';
  end if;
  if nullif(btrim(coalesce(p_conta, '')), '') is null then
    raise exception 'Informe a conta.';
  end if;
  if nullif(btrim(coalesce(p_conta_digito, '')), '') is null then
    raise exception 'Informe o dígito da conta.';
  end if;
  if nullif(btrim(coalesce(p_titular_nome, '')), '') is null then
    raise exception 'Informe o nome do titular da conta.';
  end if;
  if v_documento !~ '^[0-9]{11}$|^[0-9]{14}$' then
    raise exception 'CPF ou CNPJ do titular inválido — use só números.';
  end if;

  update public.distributors
     set metodo_repasse = 'ted',
         banco_codigo = btrim(p_banco_codigo), banco_agencia = btrim(p_agencia),
         banco_conta = btrim(p_conta), banco_conta_digito = btrim(p_conta_digito),
         banco_conta_tipo = p_conta_tipo, banco_titular_nome = btrim(p_titular_nome),
         banco_titular_documento = v_documento,
         chave_pix = null, chave_pix_tipo = null
   where id = v_uid;

  if not found then
    raise exception 'Salve a razão social e o CNPJ no seu perfil primeiro — isso cria o seu cadastro de distribuidora.';
  end if;
end;
$$;
