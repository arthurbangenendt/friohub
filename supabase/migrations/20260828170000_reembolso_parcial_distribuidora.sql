-- ============================================================================
-- Reembolso parcial passa a ajustar o repasse pendente da DISTRIBUIDORA
-- também, não só do profissional
--
-- `aplicar_reembolso_proporcional` (20260825090000_disputas_reembolso_fundacao.sql)
-- já reduzia proporcionalmente `professional_payable` E `distributor_payable`
-- no LEDGER (payment_allocations/financial_postings) — isso sempre esteve
-- certo. Mas o ajuste do `payment_transfers.amount` ainda não enviado
-- (pending_creation) só existia pro profissional, num bloco dedicado depois
-- do loop, keyed só por job_id. Até aqui isso era inofensivo porque nenhuma
-- linha de payment_transfers de distribuidora existia — a partir de
-- `preparar_repasse_distribuidora` (20260828160000), isso vira um bug de
-- pagamento real: reembolso parcial aprovado, mas o repasse pendente da
-- distribuidora sai pelo valor CHEIO original.
--
-- Correção: move o ajuste pra DENTRO do loop que já percorre cada
-- beneficiário (profissional e cada distribuidora), casando por
-- (job_id, beneficiary_id) em vez de assumir "o único repasse pendente deste
-- job é do profissional" — um job pode ter várias distribuidoras.
--
-- De quebra, remove `v_professional_id`, variável nunca lida (já aparecia
-- como warning em `npm run db:lint` antes desta migration).
-- ============================================================================

create or replace function public.aplicar_reembolso_proporcional(
  p_charge_id uuid,
  p_valor_reembolso numeric,
  p_idempotency_key text,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charge          public.payment_charges%rowtype;
  v_job_id          uuid;
  v_receipt_id      uuid;
  v_restante        numeric(12,2);
  v_reduz_comissao  numeric(12,2) := 0;
  v_reduz_margem    numeric(12,2) := 0;
  v_comissao_disp   numeric(12,2);
  v_margem_disp     numeric(12,2);
  v_total_payable   numeric(12,2);
  v_lines           jsonb := '[]'::jsonb;
  v_linha           record;
  v_journal_id      uuid;
begin
  select * into v_charge from public.payment_charges where id = p_charge_id for update;
  if not found then raise exception 'Cobrança não encontrada.'; end if;
  if p_valor_reembolso is null or p_valor_reembolso <= 0 or p_valor_reembolso > v_charge.amount then
    raise exception 'Valor de reembolso inválido.';
  end if;

  select id into v_receipt_id from public.financial_journals
   where charge_id = p_charge_id and journal_type = 'payment_received';
  if v_receipt_id is null then
    raise exception 'Reembolso sem lançamento de recebimento original.';
  end if;
  if exists (select 1 from public.financial_journals where reversal_of = v_receipt_id) then
    raise exception 'Esta cobrança já teve reembolso registrado — revise manualmente.';
  end if;

  select job_id into v_job_id from public.orders where id = v_charge.order_id;

  v_restante := p_valor_reembolso;

  -- 1) Receita da plataforma absorve primeiro: comissão, depois margem de produto.
  select coalesce(amount, 0) into v_comissao_disp from public.payment_allocations
   where charge_id = p_charge_id and allocation_type = 'platform_commission';
  v_reduz_comissao := least(v_restante, coalesce(v_comissao_disp, 0));
  v_restante := v_restante - v_reduz_comissao;

  select coalesce(amount, 0) into v_margem_disp from public.payment_allocations
   where charge_id = p_charge_id and allocation_type = 'platform_product_margin';
  v_reduz_margem := least(v_restante, coalesce(v_margem_disp, 0));
  v_restante := v_restante - v_reduz_margem;

  if v_reduz_comissao > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', 'platform_commission', 'direction', 'debit', 'amount', v_reduz_comissao);
  end if;
  if v_reduz_margem > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', 'platform_product_margin', 'direction', 'debit', 'amount', v_reduz_margem);
  end if;

  -- 2) Se ainda sobrar, reduz profissional e distribuidora(s), proporcional
  --    ao que cada um tinha a receber desta cobrança. Um job pode ter mais
  --    de uma distribuidora envolvida — por isso o ajuste do repasse
  --    pendente casa por (job_id, beneficiary_id), não só job_id.
  if v_restante > 0 then
    select coalesce(sum(amount), 0) into v_total_payable from public.payment_allocations
     where charge_id = p_charge_id and allocation_type in ('professional_payable', 'distributor_payable');

    if v_total_payable <= 0 or v_total_payable < v_restante then
      raise exception 'Reembolso de % excede o que a plataforma tem disponível para absorver nesta cobrança.', p_valor_reembolso;
    end if;

    for v_linha in
      select allocation_type, beneficiary_id, amount from public.payment_allocations
       where charge_id = p_charge_id and allocation_type in ('professional_payable', 'distributor_payable')
         and amount > 0
    loop
      declare
        v_reduz numeric(12,2) := round(v_restante * (v_linha.amount / v_total_payable), 2);
        v_transfer_amount numeric(12,2);
      begin
        if v_reduz > 0 then
          v_lines := v_lines || jsonb_build_object(
            'account_code', v_linha.allocation_type, 'direction', 'debit',
            'amount', v_reduz, 'beneficiary_id', v_linha.beneficiary_id
          );

          -- Ajusta (ou zera) um repasse ainda não processado DESTE
          -- beneficiário para este job — vale tanto pro profissional quanto
          -- pra cada distribuidora envolvida.
          if v_job_id is not null then
            select amount into v_transfer_amount from public.payment_transfers
             where job_id = v_job_id and beneficiary_id = v_linha.beneficiary_id and status = 'pending_creation'
             for update;
            if found then
              if v_transfer_amount <= v_reduz then
                update public.payment_transfers set status = 'cancelled'
                 where job_id = v_job_id and beneficiary_id = v_linha.beneficiary_id and status = 'pending_creation';
              else
                update public.payment_transfers set amount = v_transfer_amount - v_reduz
                 where job_id = v_job_id and beneficiary_id = v_linha.beneficiary_id and status = 'pending_creation';
              end if;
            end if;
          end if;
        end if;
      end;
    end loop;
  end if;

  v_lines := jsonb_build_array(jsonb_build_object('account_code', 'gateway_clearing', 'direction', 'credit', 'amount', p_valor_reembolso)) || v_lines;

  v_journal_id := public.registrar_lancamento_financeiro(
    v_charge.order_id, p_charge_id, 'payment_reversed',
    p_idempotency_key, null, 'Reembolso parcial — comissão da plataforma absorve primeiro',
    coalesce(p_occurred_at, now()), v_lines, v_receipt_id
  );

  return v_journal_id;
end;
$$;

revoke all on function public.aplicar_reembolso_proporcional(uuid, numeric, text, timestamptz) from public, anon, authenticated;
