-- ============================================================================
-- Tier 5 — Disputas e reembolso automático: fundação
--
-- Fecha um gap que ficou explícito quando a cobrança real foi ligada:
-- `contestar_execucao_job` (20260819140000) trava o repasse ao profissional,
-- mas nada resolve a disputa — não existe reembolso de verdade em lugar
-- nenhum do código. `processar_evento_gateway` (última versão em
-- 20260818156000) já reage a `PAYMENT_REFUNDED` (reversão total), mas o
-- branch `PAYMENT_PARTIALLY_REFUNDED` é um stub deliberado que trava a
-- conciliação para sempre — "reembolso parcial exige política de alocação
-- ainda não aprovada". É essa política que esta migration define.
--
-- Decisão de negócio (registrada em conversa com o dono do produto): quando o
-- reembolso é parcial, a comissão da FrioHub absorve o prejuízo primeiro
-- (comissão de serviço, depois margem de produto) — só se isso não bastar é
-- que o valor a pagar ao profissional/distribuidora é reduzido. Protege quem
-- já executou o trabalho de uma decisão que não é dele.
-- ============================================================================

set lock_timeout = '5s';
set statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 0. Bug pré-existente encontrado escrevendo esta migration: `20260818140000`
--    adicionou `p_subscription_id` a `registrar_lancamento_financeiro` via
--    `create or replace`, mas acrescentar parâmetro muda a identidade da
--    função para o Postgres — em vez de substituir, isso criou uma SEGUNDA
--    sobrecarga (9 parâmetros) convivendo com a nova (10). Qualquer chamada
--    passando só os 9 argumentos originais (como a que este arquivo faz logo
--    abaixo) fica ambígua entre as duas. Corrige removendo a sobrecarga
--    velha — comportamento idêntico ao que ela tinha, já que a nova só
--    acrescenta um parâmetro opcional (default null).
-- ---------------------------------------------------------------------------
drop function if exists public.registrar_lancamento_financeiro(uuid, uuid, text, text, text, text, timestamptz, jsonb, uuid);

-- ---------------------------------------------------------------------------
-- 0.1. FALHA DE SEGURANÇA REAL, JÁ EM PRODUÇÃO desde 20260818140000: a
--    sobrecarga de 10 parâmetros nunca recebeu o `revoke all` que a de 9
--    parâmetros tinha (linha acima) — `create or replace` não herda grants
--    quando cria uma sobrecarga nova. Resultado: `registrar_lancamento_
--    financeiro`, a função que grava lançamentos no ledger financeiro
--    (`security definer`, escreve em `financial_journals`/`financial_
--    postings` direto), está executável por `anon` e `authenticated` hoje —
--    qualquer usuário logado (ou nem isso) pode chamar
--    `POST /rest/v1/rpc/registrar_lancamento_financeiro` e inserir
--    lançamentos financeiros arbitrários, sujeitos só ao balanceamento
--    débito=crédito, não a nenhuma regra de negócio. Corrige aqui porque foi
--    encontrado mexendo exatamente nesta função — não é do escopo do Tier 5,
--    mas não dava para deixar passar.
-- ---------------------------------------------------------------------------
revoke all on function public.registrar_lancamento_financeiro(
  uuid, uuid, text, text, text, text, timestamptz, jsonb, uuid, uuid
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. `job_disputes` — fila única que o admin resolve.
--
--    Duas origens possíveis (`tipo`): a contestação pós-conclusão que já
--    existia (agora vira uma linha aqui em vez de só um campo solto em
--    `payment_transfers`) e o cancelamento novo de um job pago ainda em
--    execução.
-- ---------------------------------------------------------------------------
create table public.job_disputes (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.jobs (id) on delete restrict,
  aberto_por        uuid not null references public.profiles (id) on delete restrict,

  tipo              text not null check (tipo in ('contestacao_pos_conclusao', 'cancelamento_em_execucao')),
  motivo            text not null,
  valor_referencia  numeric(12,2) not null default 0,

  -- Só relevante para 'contestacao_pos_conclusao': o que aconteceu com o
  -- repasse no momento em que a contestação chegou.
  --   bloqueado   — repasse ainda pending_creation, foi travado com sucesso.
  --   ja_enviado  — repasse já pending/confirmed: dinheiro já saiu de
  --                 verdade, reaver isso do profissional é processo manual.
  --   sem_repasse — não havia repasse bloqueável (falhou por outro motivo,
  --                 ou ainda não existe) — nada a travar nem a reaver.
  situacao_repasse text check (situacao_repasse in ('bloqueado', 'ja_enviado', 'sem_repasse')),

  status            text not null default 'aberta'
                    check (status in (
                      'aberta', 'processando_reembolso',
                      'aprovada_reembolso_total', 'aprovada_reembolso_parcial',
                      'rejeitada'
                    )),
  valor_reembolso   numeric(12,2),

  resolvido_por     uuid references public.profiles (id) on delete set null,
  resolvido_em      timestamptz,
  nota_admin        text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_job_disputes_job on public.job_disputes (job_id, created_at desc);
create index idx_job_disputes_abertas on public.job_disputes (created_at desc) where status in ('aberta', 'processando_reembolso');

alter table public.job_disputes enable row level security;

create policy "job_disputes_dono_read" on public.job_disputes
  for select to authenticated
  using (aberto_por = (select auth.uid()) or (select public.eh_admin()));

grant select on public.job_disputes to authenticated;
revoke insert, update, delete on public.job_disputes from anon, authenticated;

create trigger trg_job_disputes_touch
  before update on public.job_disputes
  for each row execute function public.touch_updated_at();

comment on table public.job_disputes is
  'Fila única de disputas de serviço (contestação pós-conclusão ou cancelamento de job pago em execução), resolvida pelo admin em /admin/disputas.';

-- ---------------------------------------------------------------------------
-- 2. Rateio do reembolso parcial — núcleo financeiro deste tier.
--
--    Usada tanto pelo fluxo de disputa (Parte 3) quanto pelo webhook
--    (`PAYMENT_PARTIALLY_REFUNDED` abaixo) — qualquer reembolso parcial,
--    iniciado por nós ou feito direto no painel do Asaas, passa pela mesma
--    política.
--
--    Efeito colateral necessário: se o profissional ainda tem um repasse
--    `pending_creation` para o job desta cobrança, o valor dele é ajustado
--    (ou zerado) na hora — senão o worker de repasse pagaria o valor
--    original, ignorando o reembolso.
-- ---------------------------------------------------------------------------
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
  v_professional_id uuid;
  v_receipt_id      uuid;
  v_restante        numeric(12,2);
  v_reduz_comissao  numeric(12,2) := 0;
  v_reduz_margem    numeric(12,2) := 0;
  v_reduz_prof      numeric(12,2) := 0;
  v_comissao_disp   numeric(12,2);
  v_margem_disp     numeric(12,2);
  v_total_payable   numeric(12,2);
  v_lines           jsonb := '[]'::jsonb;
  v_linha           record;
  v_journal_id      uuid;
  v_transfer_amount numeric(12,2);
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
  select profissional_id into v_professional_id from public.jobs where id = v_job_id;

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
  --    ao que cada um tinha a receber desta cobrança.
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
      begin
        if v_reduz > 0 then
          v_lines := v_lines || jsonb_build_object(
            'account_code', v_linha.allocation_type, 'direction', 'debit',
            'amount', v_reduz, 'beneficiary_id', v_linha.beneficiary_id
          );
          if v_linha.allocation_type = 'professional_payable' then
            v_reduz_prof := v_reduz_prof + v_reduz;
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

  -- Ajusta (ou zera) um repasse ainda não processado para este job, para o
  -- worker não pagar o valor original ignorando o reembolso.
  if v_reduz_prof > 0 and v_job_id is not null then
    select amount into v_transfer_amount from public.payment_transfers
     where job_id = v_job_id and status = 'pending_creation'
     for update;
    if found then
      if v_transfer_amount <= v_reduz_prof then
        update public.payment_transfers set status = 'cancelled'
         where job_id = v_job_id and status = 'pending_creation';
      else
        update public.payment_transfers set amount = v_transfer_amount - v_reduz_prof
         where job_id = v_job_id and status = 'pending_creation';
      end if;
    end if;
  end if;

  return v_journal_id;
end;
$$;

revoke all on function public.aplicar_reembolso_proporcional(uuid, numeric, text, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Corrige o stub: reembolso parcial feito direto no painel do Asaas
--    (fora do fluxo de disputa) passa a usar a mesma política.
-- ---------------------------------------------------------------------------
create or replace function public.processar_evento_gateway(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.payment_gateway_events%rowtype;
  v_charge public.payment_charges%rowtype;
  v_lines jsonb;
  v_receipt_id uuid;
  v_result text;
  v_next_due date;
  v_subscription_viva boolean;
  v_novo_valor numeric(12,2);
begin
  select * into v_event from public.payment_gateway_events
   where id = p_event_id for update;
  if not found then raise exception 'Evento não encontrado.'; end if;
  if v_event.processing_status in ('processed', 'ignored') then
    return v_event.processing_status;
  end if;

  update public.payment_gateway_events
     set attempts = attempts + 1, last_error = null
   where id = v_event.id;

  select * into v_charge from public.payment_charges
   where gateway = v_event.gateway
     and gateway_payment_id = v_event.gateway_payment_id
   for update;

  if not found then
    update public.payment_gateway_events
       set processing_status = 'error', last_error = 'Cobrança ainda não vinculada.'
     where id = v_event.id;
    return 'error';
  end if;

  case v_event.event_type
    when 'PAYMENT_CREATED' then
      if v_charge.status = 'pending_creation' then
        update public.payment_charges set status = 'pending' where id = v_charge.id;
      end if;

    when 'PAYMENT_UPDATED' then
      null;

    when 'PAYMENT_CONFIRMED' then
      if v_charge.status in ('pending_creation', 'pending', 'overdue') then
        update public.payment_charges
           set status = 'confirmed', confirmed_at = coalesce(confirmed_at, v_event.occurred_at)
         where id = v_charge.id;
      end if;

    when 'PAYMENT_RECEIVED' then
      if v_event.amount is not null and v_event.amount <> v_charge.amount then
        update public.payment_gateway_events
           set processing_status = 'error',
               last_error = format('Valor divergente: esperado %s, recebido %s.', v_charge.amount, v_event.amount)
         where id = v_event.id;
        return 'error';
      end if;

      select jsonb_agg(jsonb_build_object(
        'account_code', case allocation_type
          when 'professional_payable' then 'professional_payable'
          when 'distributor_payable' then 'distributor_payable'
          when 'platform_commission' then 'platform_commission'
          when 'platform_product_margin' then 'platform_product_margin'
          when 'platform_subscription_revenue' then 'platform_subscription_revenue'
        end,
        'direction', 'credit',
        'amount', amount,
        'beneficiary_id', beneficiary_id
      )) filter (where amount > 0)
      into v_lines
      from public.payment_allocations where charge_id = v_charge.id;

      v_lines := jsonb_build_array(jsonb_build_object(
        'account_code', 'gateway_clearing',
        'direction', 'debit',
        'amount', v_charge.amount
      )) || coalesce(v_lines, '[]'::jsonb);

      perform public.registrar_lancamento_financeiro(
        v_charge.order_id, v_charge.id, 'payment_received',
        format('gateway-received:%s:%s', v_event.gateway, v_charge.gateway_payment_id),
        v_event.gateway_event_id, 'Pagamento liquidado no gateway',
        v_event.occurred_at, v_lines, null, v_charge.subscription_id
      );

      update public.payment_charges
         set status = 'received', received_at = coalesce(received_at, v_event.occurred_at)
       where id = v_charge.id and status not in ('refunded', 'disputed', 'cancelled');

      if v_charge.order_id is not null then
        update public.orders set payment_status = 'pago', payment_ref = v_charge.gateway_payment_id
         where id = v_charge.order_id and payment_status <> 'reembolsado';
      end if;

      if v_charge.subscription_id is not null then
        select (status <> 'cancelled') into v_subscription_viva
          from public.plan_subscriptions where id = v_charge.subscription_id;

        if coalesce(v_subscription_viva, false) then
          if v_charge.plano_alvo_id is not null then
            select case (select ciclo from public.plan_subscriptions where id = v_charge.subscription_id)
                     when 'anual' then preco_anual else preco_mensal
                   end
              into v_novo_valor
              from public.subscription_plans where id = v_charge.plano_alvo_id;

            update public.plan_subscriptions
               set plan_id = v_charge.plano_alvo_id,
                   amount = coalesce(v_novo_valor, amount),
                   auto_renova = true,
                   cancelled_at = null,
                   proximo_plano_id = null
             where id = v_charge.subscription_id;
          else
            v_next_due := (v_event.occurred_at at time zone 'utc')::date
              + case (select ciclo from public.plan_subscriptions where id = v_charge.subscription_id)
                  when 'anual' then interval '1 year' else interval '1 month'
                end;
            update public.plan_subscriptions
               set status = 'active', next_due_date = v_next_due
             where id = v_charge.subscription_id;
          end if;

          update public.professionals
             set subscription_status = 'ativa',
                 subscription_plan_id = (select plan_id from public.plan_subscriptions where id = v_charge.subscription_id)
           where id = (select professional_id from public.plan_subscriptions where id = v_charge.subscription_id);
        end if;
      end if;

    when 'PAYMENT_OVERDUE' then
      if v_charge.status in ('pending', 'confirmed') then
        update public.payment_charges set status = 'overdue' where id = v_charge.id;
      end if;
      if v_charge.subscription_id is not null then
        update public.plan_subscriptions set status = 'overdue'
         where id = v_charge.subscription_id and status <> 'cancelled';
        update public.professionals set subscription_status = 'inadimplente'
         where id = (select professional_id from public.plan_subscriptions where id = v_charge.subscription_id)
           and exists (
             select 1 from public.plan_subscriptions
              where id = v_charge.subscription_id and status = 'overdue'
           );
      end if;

    when 'PAYMENT_DELETED', 'PAYMENT_BANK_SLIP_CANCELLED' then
      if v_charge.status in ('pending_creation', 'pending', 'confirmed', 'overdue') then
        update public.payment_charges set status = 'cancelled' where id = v_charge.id;
        if v_charge.order_id is not null then
          update public.orders set payment_status = 'falhou'
           where id = v_charge.order_id and payment_status = 'pendente';
        end if;
      end if;

    when 'PAYMENT_REFUNDED' then
      select id into v_receipt_id from public.financial_journals
       where charge_id = v_charge.id and journal_type = 'payment_received';

      if v_receipt_id is null then
        update public.payment_gateway_events
           set processing_status = 'error', last_error = 'Reembolso sem lançamento de recebimento.'
         where id = v_event.id;
        return 'error';
      end if;

      select jsonb_agg(jsonb_build_object(
        'account_code', p.account_code,
        'direction', case when p.direction = 'debit' then 'credit' else 'debit' end,
        'amount', p.amount,
        'beneficiary_id', p.beneficiary_id
      ) order by p.created_at, p.id)
      into v_lines
      from public.financial_postings p where p.journal_id = v_receipt_id;

      perform public.registrar_lancamento_financeiro(
        v_charge.order_id, v_charge.id, 'payment_reversed',
        format('gateway-refunded:%s:%s', v_event.gateway, v_charge.gateway_payment_id),
        v_event.gateway_event_id, 'Reversão integral do pagamento',
        v_event.occurred_at, v_lines, v_receipt_id, v_charge.subscription_id
      );

      update public.payment_charges
         set status = 'refunded', refunded_at = coalesce(refunded_at, v_event.occurred_at)
       where id = v_charge.id;
      if v_charge.order_id is not null then
        update public.orders set payment_status = 'reembolsado'
         where id = v_charge.order_id;
      end if;

    when 'PAYMENT_PARTIALLY_REFUNDED' then
      -- Reembolso parcial feito direto no painel do Asaas (fora do fluxo de
      -- disputa do FrioHub) — mesma política de rateio: comissão absorve
      -- primeiro. `v_event.amount` aqui é o valor JÁ REEMBOLSADO total
      -- reportado pelo gateway; comparamos com o que já registramos via
      -- `financial_journals.reversal_of` para não reprocessar.
      if exists (
        select 1 from public.financial_journals jr
         where jr.reversal_of = (
           select id from public.financial_journals
            where charge_id = v_charge.id and journal_type = 'payment_received'
         )
      ) then
        -- Já processado (provavelmente pelo fluxo de disputa) — só espelha o status.
        update public.payment_charges set status = 'partially_refunded' where id = v_charge.id;
      elsif v_event.amount is null or v_event.amount <= 0 or v_event.amount >= v_charge.amount then
        update public.payment_gateway_events
           set processing_status = 'error', last_error = 'Valor de reembolso parcial inválido para aplicar automaticamente.'
         where id = v_event.id;
        return 'error';
      else
        perform public.aplicar_reembolso_proporcional(
          v_charge.id, v_event.amount,
          format('gateway-partial-refund:%s:%s', v_event.gateway, v_charge.gateway_payment_id),
          v_event.occurred_at
        );
        update public.payment_charges set status = 'partially_refunded' where id = v_charge.id;
      end if;

    when 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE' then
      update public.payment_charges set status = 'disputed' where id = v_charge.id;

    else
      update public.payment_gateway_events
         set processing_status = 'ignored', processed_at = now()
       where id = v_event.id;
      return 'ignored';
  end case;

  update public.payment_charges
     set last_gateway_event_at = greatest(
       coalesce(last_gateway_event_at, '-infinity'::timestamptz), v_event.occurred_at
     )
   where id = v_charge.id;

  update public.payment_gateway_events
     set processing_status = 'processed', processed_at = now(), last_error = null
   where id = v_event.id;
  v_result := 'processed';
  return v_result;
exception when others then
  update public.payment_gateway_events
     set processing_status = 'error', attempts = attempts + 1,
         last_error = left(sqlerrm, 2000)
   where id = p_event_id;
  return 'error';
end;
$$;
