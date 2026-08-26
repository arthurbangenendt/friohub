-- ============================================================================
-- Intervenção de admin em repasse financeiro travado (payment_transfers)
-- ============================================================================
--
-- Diferente de `purchase_orders` (repasse de mercadoria, admin já intervinha
-- via avancar_purchase_order), `payment_transfers` movimenta dinheiro real via
-- Asaas Transfers e, até aqui, só `service_role` mexia nele
-- (listar_repasses_prontos, vincular_transferencia_gateway,
-- marcar_repasse_falho, processar_evento_gateway_transferencia — todas em
-- 20260819160000). Um repasse que cai em `failed` fica parado pra sempre até
-- alguém agir: por desenho, ele NUNCA volta sozinho pra fila (ver comentário
-- de risco em 20260819160000_repasse_asaas_transfer.sql) — a única saída até
-- agora era update direto no banco.
--
-- Duas ações, cada uma só permitida no estado onde é seguro:
--   'reenviar' — só de `failed`. Volta pra `pending_creation`, preservando
--     `idempotency_key` (sem isso o Asaas trataria como nova transferência —
--     risco de PIX duplicado). O worker existente pega no próximo ciclo.
--   'cancelar' — só de `pending_creation` ou `failed`, NUNCA de `pending`
--     (pode já estar em voo no gateway, cancelar aqui seria mentir sobre o
--     que já aconteceu) nem `confirmed` (dinheiro já saiu).
--
-- O guarda-corpo mora na função, não só na UI — mesmo padrão de
-- `avancar_purchase_order`.

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
    update public.payment_transfers
       set status = v_novo_status, failed_at = null, last_error = null
     where id = p_transfer_id;
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
  'Reenvia (failed -> pending_creation) ou cancela (pending_creation/failed -> cancelled) um repasse travado, com autorização, justificativa obrigatória e auditoria. Nunca mexe em pending/confirmed — dinheiro pode já ter saído.';
