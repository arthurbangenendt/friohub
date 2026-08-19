-- ============================================================================
-- Cobrança real do cliente na aceitação da proposta
--
-- `aceitar_quote` (20260817122000) só cria o contrato (jobs/orders) — nunca
-- chamou `preparar_cobranca_order`. Esta migration conecta os dois lados sem
-- alterar `aceitar_quote`: o Next.js chama esta RPC logo depois de aceitar,
-- e a Edge Function `asaas-cobrar-servico` (fora do banco) faz a chamada real
-- ao Asaas. Tudo isto fica atrás da feature flag `asaas_payments`
-- (`20260813184012_resilience_phase5.sql`, hoje desligada em toda região) —
-- nenhuma cobrança real nasce enquanto ela não for ligada.
--
-- Pré-requisito que AINDA FALTA para a cobrança funcionar de ponta a ponta em
-- produção: o cliente precisa de CPF/CNPJ (`profile_private.cpf_cnpj`), que
-- hoje só é coletado opcionalmente no cadastro. Sem isso, o Asaas recusa criar
-- o customer e a Edge Function devolve erro — de propósito best-effort (não
-- desfaz o aceite), mas não fica funcional até existir um campo de coleta no
-- fluxo de aceite. Registrado aqui para não fingir que está completo.
-- ============================================================================

-- Mesmo padrão de obter/definir_cpf_cnpj_professional, mas para QUALQUER
-- perfil (o pagador do serviço é o cliente, não o profissional) — lê/escreve
-- profile_private em vez de professionals.
create or replace function public.obter_cpf_cnpj_cliente(p_user_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select cpf_cnpj from public.profile_private where id = p_user_id;
$$;

revoke all on function public.obter_cpf_cnpj_cliente(uuid) from public, anon, authenticated;
grant execute on function public.obter_cpf_cnpj_cliente(uuid) to service_role;

create or replace function public.definir_cpf_cnpj_cliente(p_user_id uuid, p_cpf_cnpj text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profile_private
     set cpf_cnpj = p_cpf_cnpj
   where id = p_user_id and cpf_cnpj is null;

  if not found and not exists (select 1 from public.profile_private where id = p_user_id) then
    insert into public.profile_private (id, cpf_cnpj) values (p_user_id, p_cpf_cnpj);
  end if;
end;
$$;

revoke all on function public.definir_cpf_cnpj_cliente(uuid, text) from public, anon, authenticated;
grant execute on function public.definir_cpf_cnpj_cliente(uuid, text) to service_role;

-- Envelope de `preparar_cobranca_order` com checagem de dono: a Edge Function
-- só tem o job_id (do lado do cliente) e o uid do JWT — é aqui que se prova
-- que quem está pedindo a cobrança é o cliente DAQUELE job, não qualquer
-- cliente autenticado tentando cobrar a order de outra pessoa.
create or replace function public.preparar_cobranca_servico(p_job_id uuid, p_cliente_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  select o.id into v_order_id
    from public.orders o
    join public.jobs j on j.id = o.job_id
   where o.job_id = p_job_id and j.cliente_id = p_cliente_id;

  if v_order_id is null then
    raise exception 'Serviço não encontrado para este cliente.';
  end if;

  return public.preparar_cobranca_order(
    v_order_id, 'asaas', 'UNDEFINED', format('order:%s:cobranca-servico', v_order_id)
  );
end;
$$;

revoke all on function public.preparar_cobranca_servico(uuid, uuid) from public, anon, authenticated;
grant execute on function public.preparar_cobranca_servico(uuid, uuid) to service_role;
