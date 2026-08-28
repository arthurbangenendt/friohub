-- ============================================================================
-- "Reenviar" repasse falho relia a chave Pix/dados bancários ANTIGOS
--
-- `admin_intervir_repasse` (20260826092000) só devolvia
-- `payment_transfers.status` pra `pending_creation`, sem reler a config de
-- repasse atual do beneficiário. Se a falha original foi "sem chave/conta
-- cadastrada" e o profissional/distribuidora cadastrou DEPOIS, reenviar caía
-- no mesmo erro em loop — o snapshot continuava vazio, porque `pix_key`/
-- `pix_key_type`/campos bancários são congelados no momento do PREPARO, não
-- do reenvio (ver comentário em 20260819140000_payment_transfers.sql:48-50).
-- Isso sempre foi um risco pro profissional; fica mais provável de acontecer
-- agora que a distribuidora também tem repasse automático
-- (20260828160000), então corrijo junto.
--
-- `idempotency_key` continua intocado — reenviar não pode virar uma
-- transferência nova aos olhos do Asaas.
-- ============================================================================

create or replace function public.admin_intervir_repasse(
  p_transfer_id uuid,
  p_acao text,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_transfer public.payment_transfers%rowtype;
  v_reason text := nullif(btrim(p_motivo), '');
  v_novo_status text;
  v_prof public.professionals%rowtype;
  v_dist public.distributors%rowtype;
begin
  if v_uid is null or not public.eh_admin() then
    raise exception 'Acesso restrito a administradores.';
  end if;

  if p_acao not in ('reenviar', 'cancelar') then
    raise exception 'Ação inválida.';
  end if;

  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'Informe uma justificativa entre 5 e 500 caracteres.';
  end if;

  select * into v_transfer from public.payment_transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'Repasse não encontrado.';
  end if;

  if p_acao = 'reenviar' then
    if v_transfer.status <> 'failed' then
      raise exception 'Só é possível reenviar um repasse com status "failed" (atual: "%").', v_transfer.status;
    end if;
    v_novo_status := 'pending_creation';

    -- Relê a config de repasse ATUAL do beneficiário — o snapshot congelado
    -- no preparo pode estar vazio/desatualizado exatamente pelo motivo que
    -- causou a falha original. Valida ANTES de escrever: `payment_transfers`
    -- tem CHECK de consistência por método (pix_key/pix_key_type nunca nulos
    -- quando metodo='pix') — escrever primeiro e validar depois faria o
    -- UPDATE estourar com um erro de constraint cru em vez desta mensagem.
    if v_transfer.purchase_order_id is not null then
      select * into v_dist from public.distributors where id = v_transfer.beneficiary_id;
      if v_dist.metodo_repasse is null then
        raise exception 'Distribuidora ainda não cadastrou forma de repasse — não é possível reenviar.';
      end if;
      update public.payment_transfers
         set status = v_novo_status, failed_at = null, last_error = null,
             metodo = v_dist.metodo_repasse,
             pix_key = case when v_dist.metodo_repasse = 'pix' then coalesce(v_dist.chave_pix, '') end,
             pix_key_type = case when v_dist.metodo_repasse = 'pix' then coalesce(v_dist.chave_pix_tipo, '') end,
             banco_codigo = case when v_dist.metodo_repasse = 'ted' then v_dist.banco_codigo end,
             banco_agencia = case when v_dist.metodo_repasse = 'ted' then v_dist.banco_agencia end,
             banco_conta = case when v_dist.metodo_repasse = 'ted' then v_dist.banco_conta end,
             banco_conta_digito = case when v_dist.metodo_repasse = 'ted' then v_dist.banco_conta_digito end,
             banco_conta_tipo = case when v_dist.metodo_repasse = 'ted' then v_dist.banco_conta_tipo end,
             banco_titular_nome = case when v_dist.metodo_repasse = 'ted' then v_dist.banco_titular_nome end,
             banco_titular_documento = case when v_dist.metodo_repasse = 'ted' then v_dist.banco_titular_documento end
       where id = p_transfer_id;
    else
      select * into v_prof from public.professionals where id = v_transfer.beneficiary_id;
      if v_prof.chave_pix is null then
        raise exception 'Profissional ainda não cadastrou chave PIX — não é possível reenviar.';
      end if;
      update public.payment_transfers
         set status = v_novo_status, failed_at = null, last_error = null,
             pix_key = coalesce(v_prof.chave_pix, ''), pix_key_type = coalesce(v_prof.chave_pix_tipo, '')
       where id = p_transfer_id;
    end if;
  else
    if v_transfer.status not in ('pending_creation', 'failed') then
      raise exception 'Só é possível cancelar um repasse ainda não enviado ao gateway (atual: "%").', v_transfer.status;
    end if;
    v_novo_status := 'cancelled';
    update public.payment_transfers
       set status = v_novo_status,
           last_error = format('Cancelado manualmente pelo admin: %s', v_reason)
     where id = p_transfer_id;
  end if;

  insert into public.admin_audit_log (
    actor_id, action, entity_type, entity_id, old_values, new_values, reason
  ) values (
    v_uid, 'payment_transfer_intervention', 'payment_transfers', p_transfer_id,
    jsonb_build_object('status', v_transfer.status, 'acao', p_acao),
    jsonb_build_object('status', v_novo_status),
    v_reason
  );
end;
$$;

revoke all on function public.admin_intervir_repasse(uuid, text, text)
  from public, anon;
grant execute on function public.admin_intervir_repasse(uuid, text, text)
  to authenticated;

comment on function public.admin_intervir_repasse(uuid, text, text) is
  'Reenvia (failed -> pending_creation, relendo a config de repasse atual do beneficiário) ou cancela (pending_creation/failed -> cancelled) um repasse travado, com autorização, justificativa obrigatória e auditoria. Nunca mexe em pending/confirmed — dinheiro pode já ter saído.';
