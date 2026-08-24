-- ============================================================================
-- Repasse correto quando um pedido tem aparelhos de 2+ distribuidoras
-- ============================================================================
--
-- Desde 20260817122000_aceitar_quote_multi_ambiente.sql, uma `orders` pode ter
-- uma `purchase_orders` por distribuidora (unique(order_id, distributor_id)).
-- `preparar_cobranca_order`, porém, ainda fazia
--   select po.distributor_id into v_distributor_id from purchase_orders po
--    where po.order_id = v_order.id
-- — uma variável escalar — e `payment_allocations` só permitia UMA linha
-- 'distributor_payable' por cobrança (unique(charge_id, allocation_type)).
-- Com 2+ distribuidoras no mesmo pedido, o repasse de todas menos uma se
-- perdia silenciosamente: nenhum erro, só uma distribuidora nunca recebia.
--
-- Fix: 'distributor_payable' passa a ter uma linha por distribuidora,
-- mantendo exatamente-uma-linha para os outros tipos de alocação (que
-- continuam tendo um único beneficiário ou nenhum).

alter table public.payment_allocations
  drop constraint if exists payment_allocations_charge_id_allocation_type_key;

create unique index if not exists uq_payment_allocations_single
  on public.payment_allocations (charge_id, allocation_type)
  where allocation_type <> 'distributor_payable';

create unique index if not exists uq_payment_allocations_distributor
  on public.payment_allocations (charge_id, beneficiary_id)
  where allocation_type = 'distributor_payable';

create or replace function public.preparar_cobranca_order(
  p_order_id uuid,
  p_gateway text,
  p_billing_type text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_job public.jobs%rowtype;
  v_charge_id uuid;
  v_professional_amount numeric(12,2);
  v_existing_order_id uuid;
begin
  if p_gateway <> 'asaas' then raise exception 'Gateway não suportado.'; end if;
  if p_billing_type not in ('UNDEFINED', 'PIX', 'BOLETO', 'CREDIT_CARD') then
    raise exception 'Forma de pagamento inválida.';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Chave de idempotência obrigatória.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Ordem não encontrada.'; end if;
  select * into v_job from public.jobs where id = v_order.job_id;
  if v_order.total <= 0 then raise exception 'Ordem sem valor cobravel.'; end if;
  if v_order.payment_status in ('pago', 'reembolsado') then
    raise exception 'Esta ordem não aceita nova cobrança.';
  end if;

  v_charge_id := gen_random_uuid();
  insert into public.payment_charges (
    id,
    order_id, customer_id, gateway, idempotency_key, external_reference,
    billing_type, amount
  ) values (
    v_charge_id,
    v_order.id, v_job.cliente_id, p_gateway, btrim(p_idempotency_key),
    format('order:%s:%s', v_order.id, md5(btrim(p_idempotency_key))),
    p_billing_type, v_order.total
  )
  on conflict (gateway, idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning id, order_id into v_charge_id, v_existing_order_id;

  if v_existing_order_id is distinct from v_order.id then
    raise exception 'Chave de idempotência já pertence a outra ordem.';
  end if;

  v_professional_amount := greatest(v_order.preco_servico - v_order.comissao_servico, 0);

  insert into public.payment_allocations (charge_id, allocation_type, beneficiary_id, amount)
  values
    (v_charge_id, 'professional_payable', v_job.profissional_id, v_professional_amount),
    (v_charge_id, 'platform_commission', null, v_order.comissao_servico),
    (v_charge_id, 'platform_product_margin', null, v_order.margem_produto)
  on conflict (charge_id, allocation_type) where allocation_type <> 'distributor_payable' do nothing;

  -- Uma linha 'distributor_payable' por distribuidora envolvida no pedido,
  -- reaproveitando o custo já somado por distribuidora que `aceitar_quote`
  -- grava em `purchase_orders.custo_snapshot`. Pedido sem produto (só
  -- serviço) não gera nenhuma linha aqui, o que é correto: nada a repassar.
  insert into public.payment_allocations (charge_id, allocation_type, beneficiary_id, amount)
  select v_charge_id, 'distributor_payable', po.distributor_id, po.custo_snapshot
    from public.purchase_orders po
   where po.order_id = v_order.id
  on conflict (charge_id, beneficiary_id) where allocation_type = 'distributor_payable' do nothing;

  if (
    select coalesce(sum(amount), 0) <> v_order.total
      from public.payment_allocations where charge_id = v_charge_id
  ) then
    raise exception 'Distribuição financeira não fecha com o total da ordem.';
  end if;

  return v_charge_id;
end;
$$;

revoke all on function public.preparar_cobranca_order(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.preparar_cobranca_order(uuid, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Efeito colateral da troca de constraint acima: as duas funções de
-- assinatura que também inserem em `payment_allocations` usavam
-- `on conflict (charge_id, allocation_type)` batendo na constraint antiga —
-- sem ela, o Postgres não acha índice para inferir o conflito e o INSERT
-- passa a dar erro. Mesmo fix nas duas: aponta pro índice parcial novo
-- (`uq_payment_allocations_single`, que cobre tudo que não é
-- 'distributor_payable' — o caso das duas). Corpo idêntico ao já existente,
-- só a cláusula `on conflict` muda.
-- ---------------------------------------------------------------------------
create or replace function public.preparar_cobranca_assinatura(
  p_subscription_id uuid,
  p_gateway text,
  p_billing_type text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.plan_subscriptions%rowtype;
  v_charge_id uuid;
  v_existing_sub_id uuid;
begin
  if p_gateway <> 'asaas' then raise exception 'Gateway não suportado.'; end if;
  if p_billing_type not in ('UNDEFINED', 'PIX', 'BOLETO', 'CREDIT_CARD') then
    raise exception 'Forma de pagamento inválida.';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Chave de idempotência obrigatória.';
  end if;

  select * into v_sub from public.plan_subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'Assinatura não encontrada.'; end if;
  if v_sub.status = 'cancelled' then raise exception 'Assinatura cancelada não aceita cobrança.'; end if;
  -- 'active' só cobra de novo pelo worker de renovação (20260819190000) —
  -- aqui é a entrada manual do profissional, que não deve gerar cobrança
  -- fora de ciclo para quem já está em dia.
  if v_sub.status = 'active' then
    raise exception 'Assinatura já está ativa; a próxima cobrança é automática no vencimento.';
  end if;

  v_charge_id := gen_random_uuid();
  insert into public.payment_charges (
    id,
    subscription_id, customer_id, gateway, idempotency_key, external_reference,
    billing_type, amount
  ) values (
    v_charge_id,
    v_sub.id, v_sub.professional_id, p_gateway, btrim(p_idempotency_key),
    format('subscription:%s:%s', v_sub.id, md5(btrim(p_idempotency_key))),
    p_billing_type, v_sub.amount
  )
  on conflict (gateway, idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning id, subscription_id into v_charge_id, v_existing_sub_id;

  if v_existing_sub_id is distinct from v_sub.id then
    raise exception 'Chave de idempotência já pertence a outra assinatura.';
  end if;

  insert into public.payment_allocations (charge_id, allocation_type, beneficiary_id, amount)
  values (v_charge_id, 'platform_subscription_revenue', null, v_sub.amount)
  on conflict (charge_id, allocation_type) where allocation_type <> 'distributor_payable' do nothing;

  return v_charge_id;
end;
$$;

revoke all on function public.preparar_cobranca_assinatura(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.preparar_cobranca_assinatura(uuid, text, text, text)
  to service_role;

create or replace function public.preparar_upgrade_assinatura(
  p_professional_id uuid,
  p_novo_plano_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.plan_subscriptions%rowtype;
  v_novo_valor numeric(12,2);
  v_dias_restantes integer;
  v_dias_ciclo integer;
  v_delta numeric(12,2);
  v_idempotency_key text;
  v_charge_id uuid;
  v_existing_sub_id uuid;
begin
  select * into v_sub from public.plan_subscriptions
   where professional_id = p_professional_id and status = 'active'
   for update;
  if not found then
    raise exception 'Nenhuma assinatura ativa para trocar de plano.';
  end if;
  if v_sub.next_due_date is null or v_sub.next_due_date <= current_date then
    raise exception 'Assinatura sem vencimento válido para calcular a troca. Regularize antes de trocar de plano.';
  end if;

  select case v_sub.ciclo when 'anual' then preco_anual else preco_mensal end
    into v_novo_valor
    from public.subscription_plans
   where id = p_novo_plano_id and ativo and publico;
  if v_novo_valor is null then raise exception 'Plano indisponível para este ciclo.'; end if;
  if v_novo_valor <= v_sub.amount then
    raise exception 'Isto não é upgrade — o plano escolhido não é mais caro que o atual.';
  end if;

  v_dias_restantes := v_sub.next_due_date - current_date;
  v_dias_ciclo := case v_sub.ciclo when 'anual' then 365 else 30 end;
  v_delta := round((v_novo_valor - v_sub.amount) * v_dias_restantes / v_dias_ciclo, 2);
  if v_delta <= 0 then raise exception 'Diferença calculada não é cobrável.'; end if;

  v_idempotency_key := format('upgrade:%s:%s:%s', v_sub.id, p_novo_plano_id, current_date);

  v_charge_id := gen_random_uuid();
  insert into public.payment_charges (
    id, subscription_id, customer_id, gateway, idempotency_key, external_reference,
    billing_type, amount, plano_alvo_id
  ) values (
    v_charge_id, v_sub.id, v_sub.professional_id, 'asaas', v_idempotency_key,
    format('upgrade:%s:%s', v_sub.id, md5(v_idempotency_key)),
    'UNDEFINED', v_delta, p_novo_plano_id
  )
  on conflict (gateway, idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning id, subscription_id into v_charge_id, v_existing_sub_id;

  if v_existing_sub_id is distinct from v_sub.id then
    raise exception 'Chave de idempotência já pertence a outra assinatura.';
  end if;

  insert into public.payment_allocations (charge_id, allocation_type, beneficiary_id, amount)
  values (v_charge_id, 'platform_subscription_revenue', null, v_delta)
  on conflict (charge_id, allocation_type) where allocation_type <> 'distributor_payable' do nothing;

  return v_charge_id;
end;
$$;

revoke all on function public.preparar_upgrade_assinatura(uuid, uuid) from public, anon, authenticated;
grant execute on function public.preparar_upgrade_assinatura(uuid, uuid) to service_role;
