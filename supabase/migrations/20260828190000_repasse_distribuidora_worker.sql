-- ============================================================================
-- Worker de repasses: suporte a TED + correção de conta contábil errada
--
-- Dois ajustes pra `preparar_repasse_distribuidora` (20260828160000) virar
-- dinheiro de verdade:
--
--   1. `listar_repasses_prontos` só devolvia pix_key/pix_key_type — o worker
--      não tinha como saber se um repasse é Pix ou TED, nem os dados
--      bancários. Passa a devolver `purchase_order_id`, `metodo` e os campos
--      de conta bancária.
--
--   2. BUG ENCONTRADO mexendo neste código: `processar_evento_gateway_
--      transferencia` (20260819160000), no caso TRANSFER_DONE, sempre lança
--      o débito no ledger como `professional_payable` — hardcoded, nunca
--      testado com outro tipo de beneficiário porque nenhum repasse de
--      distribuidora existia ainda. A partir de agora isso lançaria a baixa
--      de repasse de distribuidora na conta contábil ERRADA. Corrige
--      decidindo a conta pelo mesmo discriminador já usado em
--      admin_intervir_repasse: `purchase_order_id is not null` = distribuidora.
-- ============================================================================

-- `create or replace` não permite mudar o formato de retorno (colunas novas
-- no meio do TABLE) — precisa dropar antes.
drop function if exists public.listar_repasses_prontos(integer);

create function public.listar_repasses_prontos(p_limit integer default 20)
returns table (
  id uuid, job_id uuid, purchase_order_id uuid, amount numeric,
  metodo text, pix_key text, pix_key_type text,
  banco_codigo text, banco_agencia text, banco_conta text, banco_conta_digito text,
  banco_conta_tipo text, banco_titular_nome text, banco_titular_documento text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.payment_transfers t
     set status = 'pending'
   where t.id in (
     select pt.id from public.payment_transfers pt
      where pt.status = 'pending_creation'
        and pt.scheduled_for <= now()
        and pt.contestado_em is null
      order by pt.scheduled_for
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
      for update skip locked
   )
  returning t.id, t.job_id, t.purchase_order_id, t.amount,
            t.metodo, t.pix_key, t.pix_key_type,
            t.banco_codigo, t.banco_agencia, t.banco_conta, t.banco_conta_digito,
            t.banco_conta_tipo, t.banco_titular_nome, t.banco_titular_documento;
end;
$$;

revoke all on function public.listar_repasses_prontos(integer) from public, anon, authenticated;
grant execute on function public.listar_repasses_prontos(integer) to service_role;

comment on function public.listar_repasses_prontos(integer) is
  'Reserva (pending_creation -> pending) os repasses prontos ANTES de qualquer chamada ao '
  'Asaas — uma linha reservada nunca volta pra fila automaticamente, mesmo se a Edge '
  'Function falhar depois. Devolve os campos de Pix E de conta bancária — o worker decide '
  'qual usar por `metodo`.';

-- ---------------------------------------------------------------------------
-- Corrige a conta contábil no TRANSFER_DONE
-- ---------------------------------------------------------------------------
create or replace function public.processar_evento_gateway_transferencia(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event    public.payment_gateway_events%rowtype;
  v_transfer public.payment_transfers%rowtype;
  v_charge_id uuid;
  v_lines    jsonb;
  v_account_code text;
begin
  select * into v_event from public.payment_gateway_events where id = p_event_id for update;
  if not found then raise exception 'Evento não encontrado.'; end if;
  if v_event.processing_status in ('processed', 'ignored') then
    return v_event.processing_status;
  end if;

  update public.payment_gateway_events set attempts = attempts + 1, last_error = null where id = v_event.id;

  select * into v_transfer from public.payment_transfers
   where gateway = v_event.gateway and gateway_transfer_id = v_event.gateway_transfer_id
   for update;

  if not found then
    update public.payment_gateway_events
       set processing_status = 'error', last_error = 'Repasse ainda não vinculado.'
     where id = v_event.id;
    return 'error';
  end if;

  -- Mesmo discriminador usado em admin_intervir_repasse: purchase_order_id
  -- só é preenchido pra repasse de distribuidora.
  v_account_code := case when v_transfer.purchase_order_id is not null
    then 'distributor_payable' else 'professional_payable' end;

  case v_event.event_type
    when 'TRANSFER_CREATED', 'TRANSFER_PENDING', 'TRANSFER_IN_BANK_PROCESSING' then
      if v_transfer.status = 'pending' then
        null; -- já é o estado corrente, nada a fazer
      end if;

    when 'TRANSFER_DONE' then
      if v_transfer.status <> 'confirmed' then
        select a.charge_id into v_charge_id from public.payment_allocations a where a.id = v_transfer.allocation_id;

        v_lines := jsonb_build_array(
          jsonb_build_object('account_code', v_account_code, 'direction', 'debit',
            'amount', v_transfer.amount, 'beneficiary_id', v_transfer.beneficiary_id),
          jsonb_build_object('account_code', 'gateway_clearing', 'direction', 'credit', 'amount', v_transfer.amount)
        );
        perform public.registrar_lancamento_financeiro(
          v_transfer.order_id, v_charge_id, 'transfer_sent',
          format('gateway-transfer-done:%s:%s', v_event.gateway, v_event.gateway_transfer_id),
          v_event.gateway_event_id, 'Repasse confirmado pelo gateway',
          v_event.occurred_at, v_lines, null, null
        );

        update public.payment_transfers
           set status = 'confirmed', confirmed_at = coalesce(confirmed_at, v_event.occurred_at)
         where id = v_transfer.id;
      end if;

    when 'TRANSFER_FAILED' then
      update public.payment_transfers
         set status = 'failed', failed_at = coalesce(failed_at, v_event.occurred_at),
             last_error = coalesce(last_error, 'Transferência falhou no gateway.')
       where id = v_transfer.id and status <> 'confirmed';

    when 'TRANSFER_BLOCKED' then
      update public.payment_transfers
         set status = 'failed', failed_at = coalesce(failed_at, v_event.occurred_at),
             last_error = 'Transferência bloqueada pelo Asaas — requer verificação manual.'
       where id = v_transfer.id and status <> 'confirmed';

    when 'TRANSFER_CANCELLED' then
      update public.payment_transfers
         set status = 'cancelled'
       where id = v_transfer.id and status <> 'confirmed';

    else
      update public.payment_gateway_events set processing_status = 'ignored', processed_at = now() where id = v_event.id;
      return 'ignored';
  end case;

  update public.payment_gateway_events
     set processing_status = 'processed', processed_at = now(), last_error = null
   where id = v_event.id;
  return 'processed';
exception when others then
  update public.payment_gateway_events
     set processing_status = 'error', attempts = attempts + 1, last_error = left(sqlerrm, 2000)
   where id = p_event_id;
  return 'error';
end;
$$;

revoke all on function public.processar_evento_gateway_transferencia(uuid) from public, anon, authenticated;
grant execute on function public.processar_evento_gateway_transferencia(uuid) to service_role;
