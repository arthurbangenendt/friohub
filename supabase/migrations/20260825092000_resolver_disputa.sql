-- ============================================================================
-- Tier 5 — Resolução da disputa pelo admin
--
-- Decisão humana, execução automática: o admin decide (aprova com valor X ou
-- rejeita) numa tela nova (/admin/disputas); a aprovação dispara o estorno de
-- verdade no Asaas na hora, via edge function nova (asaas-resolver-disputa).
-- ============================================================================

set lock_timeout = '5s';
set statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 1. Reativa um repasse que uma contestação tinha bloqueado — usado tanto
--    quando a disputa é rejeitada (repasse volta integral) quanto quando é
--    aprovada com reembolso parcial (repasse volta e `aplicar_reembolso_
--    proporcional` ajusta o valor, se a comissão não bastar pra absorver
--    tudo). Limpa `contestado_em` para o repasse voltar a aparecer na fila
--    do worker (`idx_payment_transfers_pendentes` exige `contestado_em is
--    null`) — o histórico da contestação já fica em `job_disputes`.
-- ---------------------------------------------------------------------------
create or replace function public.reativar_repasse_contestado(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.payment_transfers
     set status = 'pending_creation', scheduled_for = now(),
         contestado_em = null, contestado_motivo = null
   where job_id = p_job_id and status = 'cancelled' and contestado_em is not null;
end;
$$;

revoke all on function public.reativar_repasse_contestado(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Move o job pra `cancelado` quando um cancelamento-com-reembolso é
--    aprovado. `security definer` contorna `protege_job_transicao` (que não
--    libera `em_execucao → cancelado` em UPDATE direto do cliente) — mesmo
--    padrão já usado por `enviar_orcamento_final`.
-- ---------------------------------------------------------------------------
create or replace function public.cancelar_job_pago_aprovado(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.jobs set status = 'cancelado'
   where id = p_job_id and status in ('aceito', 'em_execucao', 'aguardando_orcamento_final');
end;
$$;

revoke all on function public.cancelar_job_pago_aprovado(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Rejeição — síncrona, sem Asaas envolvido, chamada direto pela action do
--    admin (mesmo padrão de `definir_verificacao`: RPC comum, `eh_admin()`
--    via `auth.uid()`, sem passar por edge function).
-- ---------------------------------------------------------------------------
create or replace function public.resolver_disputa_rejeitar(p_dispute_id uuid, p_nota_admin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_nota   text := nullif(btrim(coalesce(p_nota_admin, '')), '');
  v_dispute public.job_disputes%rowtype;
begin
  if not (select public.eh_admin()) then
    raise exception 'Apenas administradores podem resolver disputas.';
  end if;
  if v_nota is null or length(v_nota) < 5 then
    raise exception 'Justificativa obrigatória (mínimo de 5 caracteres).';
  end if;

  select * into v_dispute from public.job_disputes where id = p_dispute_id for update;
  if not found then raise exception 'Disputa não encontrada.'; end if;
  if v_dispute.status <> 'aberta' then raise exception 'Esta disputa já foi resolvida.'; end if;

  update public.job_disputes
     set status = 'rejeitada', resolvido_por = v_uid, resolvido_em = now(), nota_admin = v_nota
   where id = p_dispute_id;

  if v_dispute.tipo = 'contestacao_pos_conclusao' and v_dispute.situacao_repasse = 'bloqueado' then
    perform public.reativar_repasse_contestado(v_dispute.job_id);
  end if;

  insert into public.admin_audit_log (actor_id, action, entity_type, entity_id, old_values, new_values, reason)
  values (v_uid, 'rejeitar_disputa', 'job_disputes', p_dispute_id, jsonb_build_object('status', v_dispute.status), jsonb_build_object('status', 'rejeitada'), v_nota);
end;
$$;

revoke all on function public.resolver_disputa_rejeitar(uuid, text) from public, anon;
grant execute on function public.resolver_disputa_rejeitar(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Aprovação, passo 1 — chamada pela edge function `asaas-resolver-
--    disputa` via service_role (o admin já foi validado lá pelo JWT; aqui
--    `p_admin_id` é conferido de novo, defesa em profundidade). Devolve o
--    plano de estorno: uma linha por cobrança `received` do job, na ordem em
--    que foram cobradas, até esgotar `p_valor_reembolso` — cobre o caso raro
--    de um job com 2 cobranças (visita + serviço final).
-- ---------------------------------------------------------------------------
create or replace function public.preparar_reembolso_disputa(
  p_dispute_id uuid,
  p_valor_reembolso numeric,
  p_admin_id uuid,
  p_nota_admin text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nota text := nullif(btrim(coalesce(p_nota_admin, '')), '');
  v_dispute public.job_disputes%rowtype;
  v_restante numeric(12,2);
  v_plano jsonb := '[]'::jsonb;
  v_linha record;
  v_parcela numeric(12,2);
begin
  if not exists (select 1 from public.profiles where id = p_admin_id and role = 'admin') then
    raise exception 'Apenas administradores podem resolver disputas.';
  end if;
  if v_nota is null or length(v_nota) < 5 then
    raise exception 'Justificativa obrigatória (mínimo de 5 caracteres).';
  end if;
  if p_valor_reembolso is null or p_valor_reembolso <= 0 then
    raise exception 'Informe um valor de reembolso válido.';
  end if;

  select * into v_dispute from public.job_disputes where id = p_dispute_id for update;
  if not found then raise exception 'Disputa não encontrada.'; end if;
  if v_dispute.status <> 'aberta' then raise exception 'Esta disputa já foi resolvida ou está em processamento.'; end if;

  v_restante := p_valor_reembolso;

  for v_linha in
    select pc.id as charge_id, pc.gateway_payment_id, pc.amount
      from public.payment_charges pc
      join public.orders o on o.id = pc.order_id
     where o.job_id = v_dispute.job_id and pc.status = 'received'
     order by pc.created_at asc
  loop
    exit when v_restante <= 0;
    if v_linha.gateway_payment_id is null then
      raise exception 'Cobrança % sem id de pagamento no gateway — não é possível estornar automaticamente.', v_linha.charge_id;
    end if;
    v_parcela := least(v_restante, v_linha.amount);
    v_plano := v_plano || jsonb_build_object('charge_id', v_linha.charge_id, 'gateway_payment_id', v_linha.gateway_payment_id, 'valor', v_parcela);
    v_restante := v_restante - v_parcela;
  end loop;

  if v_restante > 0 then
    raise exception 'Valor de reembolso (%) excede o total cobrado e recebido para este serviço.', p_valor_reembolso;
  end if;
  if jsonb_array_length(v_plano) = 0 then
    raise exception 'Nenhuma cobrança recebida encontrada para este serviço.';
  end if;

  update public.job_disputes
     set status = 'processando_reembolso', valor_reembolso = p_valor_reembolso,
         resolvido_por = p_admin_id, nota_admin = v_nota
   where id = p_dispute_id;

  return v_plano;
end;
$$;

revoke all on function public.preparar_reembolso_disputa(uuid, numeric, uuid, text) from public, anon, authenticated;
grant execute on function public.preparar_reembolso_disputa(uuid, numeric, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Aprovação, passo 2 — chamada pela edge function depois que o Asaas
--    confirmou (ou recusou) cada estorno do plano. `p_resultados`: array de
--    {charge_id, valor, sucesso, erro}. Reembolsos com sucesso são
--    contabilizados; se algum falhar, a disputa fica em
--    'processando_reembolso' (não unclamped por engano) para o admin
--    retomar manualmente em vez de ser dada como resolvida.
-- ---------------------------------------------------------------------------
create or replace function public.confirmar_reembolso_disputa(
  p_dispute_id uuid,
  p_resultados jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispute public.job_disputes%rowtype;
  v_item record;
  v_total_ok numeric(12,2) := 0;
  v_algum_falhou boolean := false;
  v_charge public.payment_charges%rowtype;
  v_status_final text;
begin
  select * into v_dispute from public.job_disputes where id = p_dispute_id for update;
  if not found then raise exception 'Disputa não encontrada.'; end if;
  if v_dispute.status <> 'processando_reembolso' then
    raise exception 'Disputa não está aguardando confirmação de reembolso.';
  end if;

  -- Reativa o repasse ANTES de aplicar o reembolso, para que, se o valor a
  -- pagar ao profissional precisar ser reduzido, `aplicar_reembolso_
  -- proporcional` já encontre a linha em pending_creation e ajuste o valor.
  if v_dispute.tipo = 'contestacao_pos_conclusao' and v_dispute.situacao_repasse = 'bloqueado' then
    perform public.reativar_repasse_contestado(v_dispute.job_id);
  end if;

  for v_item in select * from jsonb_to_recordset(p_resultados) as x(charge_id uuid, valor numeric, sucesso boolean, erro text)
  loop
    if v_item.sucesso then
      perform public.aplicar_reembolso_proporcional(
        v_item.charge_id, v_item.valor,
        format('disputa:%s:charge:%s', p_dispute_id, v_item.charge_id),
        now()
      );

      select * into v_charge from public.payment_charges where id = v_item.charge_id;
      v_status_final := case when v_item.valor >= v_charge.amount then 'refunded' else 'partially_refunded' end;
      update public.payment_charges set status = v_status_final, refunded_at = coalesce(refunded_at, now())
       where id = v_item.charge_id;
      if v_status_final = 'refunded' then
        update public.orders set payment_status = 'reembolsado' where id = v_charge.order_id;
      end if;

      v_total_ok := v_total_ok + v_item.valor;
    else
      v_algum_falhou := true;
    end if;
  end loop;

  if v_algum_falhou then
    update public.job_disputes
       set nota_admin = nota_admin || ' [Falha parcial no estorno — revisar manualmente no Asaas.]'
     where id = p_dispute_id;
    return;
  end if;

  update public.job_disputes
     set status = case when v_total_ok >= valor_referencia then 'aprovada_reembolso_total' else 'aprovada_reembolso_parcial' end,
         resolvido_em = now()
   where id = p_dispute_id;

  if v_dispute.tipo = 'cancelamento_em_execucao' then
    perform public.cancelar_job_pago_aprovado(v_dispute.job_id);
  end if;

  insert into public.admin_audit_log (actor_id, action, entity_type, entity_id, old_values, new_values, reason)
  values (v_dispute.resolvido_por, 'aprovar_disputa', 'job_disputes', p_dispute_id, jsonb_build_object('status', 'processando_reembolso'), jsonb_build_object('status', 'aprovada', 'valor_reembolsado', v_total_ok), v_dispute.nota_admin);
end;
$$;

revoke all on function public.confirmar_reembolso_disputa(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.confirmar_reembolso_disputa(uuid, jsonb) to service_role;
