-- ============================================================================
-- Forma de repasse da distribuidora — Pix ou transferência bancária (TED)
--
-- Mesma classe de sigilo de `professionals.chave_pix`
-- (20260819120000_pix_profissional.sql): dado financeiro, nunca entra em
-- grant de SELECT que a vitrine pública lê — só via RPC own-row.
--
-- Ao contrário do profissional (só Pix), a distribuidora pode preferir
-- transferência bancária tradicional. `metodo_repasse` decide qual conjunto
-- de colunas vale; o CHECK abaixo garante consistência no banco, não só na
-- validação da RPC — mesma defesa em profundidade já usada em
-- `professionals_chave_pix_par`.
-- ============================================================================

alter table public.distributors
  add column metodo_repasse text check (metodo_repasse in ('pix', 'ted')),
  add column chave_pix text,
  add column chave_pix_tipo text
    check (chave_pix_tipo in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),
  add column banco_codigo text,
  add column banco_agencia text,
  add column banco_conta text,
  add column banco_conta_digito text,
  add column banco_conta_tipo text
    check (banco_conta_tipo in ('conta_corrente', 'conta_poupanca')),
  add column banco_titular_nome text,
  add column banco_titular_documento text;

alter table public.distributors
  add constraint distributors_metodo_repasse_consistente check (
    metodo_repasse is null
    or (
      metodo_repasse = 'pix'
      and chave_pix is not null and chave_pix_tipo is not null
      and banco_codigo is null and banco_agencia is null and banco_conta is null
    )
    or (
      metodo_repasse = 'ted'
      and banco_codigo is not null and banco_agencia is not null
      and banco_conta is not null and banco_conta_digito is not null
      and banco_titular_nome is not null and banco_titular_documento is not null
      and chave_pix is null and chave_pix_tipo is null
    )
  );

comment on column public.distributors.chave_pix is
  'Chave PIX de destino do repasse automático. Documento fiscal-adjacente: '
  'NUNCA entra em grant de SELECT a anon/authenticated — só via minha_config_repasse_distribuidora().';
comment on column public.distributors.banco_titular_documento is
  'CPF/CNPJ do titular da conta bancária — a Asaas exige pra transferência TED. Mesmo sigilo de chave_pix.';

-- ---------------------------------------------------------------------------
-- Leitura própria
-- ---------------------------------------------------------------------------
create or replace function public.minha_config_repasse_distribuidora()
returns table (
  metodo_repasse text,
  chave_pix text, chave_pix_tipo text,
  banco_codigo text, banco_agencia text, banco_conta text, banco_conta_digito text,
  banco_conta_tipo text, banco_titular_nome text, banco_titular_documento text
)
language sql
security definer
stable
set search_path = public
as $$
  select metodo_repasse, chave_pix, chave_pix_tipo,
         banco_codigo, banco_agencia, banco_conta, banco_conta_digito,
         banco_conta_tipo, banco_titular_nome, banco_titular_documento
    from public.distributors
   where id = (select auth.uid());
$$;

revoke all on function public.minha_config_repasse_distribuidora() from public, anon;
grant execute on function public.minha_config_repasse_distribuidora() to authenticated;

-- ---------------------------------------------------------------------------
-- Cadastro via Pix
-- ---------------------------------------------------------------------------
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
    raise exception 'Perfil de distribuidora não encontrado.';
  end if;
end;
$$;

revoke all on function public.salvar_repasse_pix_distribuidora(text, text) from public, anon;
grant execute on function public.salvar_repasse_pix_distribuidora(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Cadastro via transferência bancária (TED)
-- ---------------------------------------------------------------------------
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
    raise exception 'Perfil de distribuidora não encontrado.';
  end if;
end;
$$;

revoke all on function public.salvar_repasse_bancario_distribuidora(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.salvar_repasse_bancario_distribuidora(text, text, text, text, text, text, text) to authenticated;

comment on function public.salvar_repasse_pix_distribuidora is
  'Distribuidora cadastra/troca Pix como forma de repasse — limpa dados bancários se houver.';
comment on function public.salvar_repasse_bancario_distribuidora is
  'Distribuidora cadastra/troca transferência bancária (TED) como forma de repasse — limpa Pix se houver.';
