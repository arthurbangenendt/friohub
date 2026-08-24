-- ============================================================================
-- Worker de renovação de assinatura (ciclo 2, 3, ...)
-- ============================================================================
--
-- Até aqui, `asaas-assinar` só cobrava o primeiro ciclo (comentário explícito
-- no próprio arquivo). `auto_renova` (20260818153000) e `proximo_plano_id`
-- (20260818154000) já foram criados prevendo este worker — os comentários das
-- duas migrations dizem literalmente "quando o worker de renovação existir"
-- e "aplicar isso no vencimento é responsabilidade do worker". É esta migration.
--
-- Duas etapas, chamadas em sequência pela Edge Function:
--   1. `aplicar_ciclo_assinaturas_vencidas()` — set-based, sem lock de linha:
--      cancela quem pediu para não renovar, aplica downgrade agendado em quem
--      vai renovar. Idempotente por natureza (reaplicar não muda nada).
--   2. `listar_assinaturas_prontas_para_renovar()` — reserva (mesmo padrão de
--      `listar_repasses_prontos`, 20260819160000) as assinaturas que sobraram
--      elegíveis para cobrança, com um `renewal_claimed_at` para não pegar a
--      mesma linha duas vezes se o cron sobrepor uma execução lenta. Sem essa
--      reserva, duas chamadas concorrentes só ficariam protegidas pela chave
--      de idempotência de `payment_charges` — que evita duplicar a COBRANÇA
--      local, mas não evita duas chamadas ao Asaas antes de qualquer uma
--      delas gravar o `checkout_url` (mesmo tipo de risco documentado no
--      cabeçalho de `asaas-processar-repasses`).
--
-- A chave de idempotência da cobrança de renovação é `subscription_id:next_due_date`
-- (o CICLO), não `subscription_id:hoje` (o dia em que o worker rodou) — se o
-- cliente demorar a pagar um boleto e o worker rodar de novo no dia seguinte
-- ainda dentro do mesmo ciclo vencido, ele reencontra a MESMA cobrança via
-- `on conflict (gateway, idempotency_key)` em vez de gerar uma nova por dia.

alter table public.plan_subscriptions
  add column if not exists renewal_claimed_at timestamptz;

comment on column public.plan_subscriptions.renewal_claimed_at is
  'Reserva do worker de renovação — evita duas execuções concorrentes cobrarem o mesmo ciclo. Reclamável de novo após 1h (execução travada/anterior falhou sem limpar).';

-- ---------------------------------------------------------------------------
-- 1. Aplica cancelamento e downgrade agendados no vencimento (set-based)
-- ---------------------------------------------------------------------------
create or replace function public.aplicar_ciclo_assinaturas_vencidas()
returns void
language sql
security definer
set search_path = public
as $$
  update public.plan_subscriptions
     set status = 'cancelled', cancelled_at = now()
   where status in ('active', 'overdue')
     and next_due_date is not null
     and next_due_date <= current_date
     and not auto_renova;

  update public.plan_subscriptions ps
     set plan_id = sp.id,
         amount = case ps.ciclo when 'anual' then sp.preco_anual else sp.preco_mensal end,
         proximo_plano_id = null
    from public.subscription_plans sp
   where ps.status in ('active', 'overdue')
     and ps.next_due_date is not null
     and ps.next_due_date <= current_date
     and ps.auto_renova
     and ps.proximo_plano_id is not null
     and sp.id = ps.proximo_plano_id;
$$;

revoke all on function public.aplicar_ciclo_assinaturas_vencidas() from public, anon, authenticated;
grant execute on function public.aplicar_ciclo_assinaturas_vencidas() to service_role;

-- ---------------------------------------------------------------------------
-- 2. Reserva atômica: claim antes de qualquer chamada HTTP ao Asaas
-- ---------------------------------------------------------------------------
create or replace function public.listar_assinaturas_prontas_para_renovar(p_limit integer default 20)
returns table (
  subscription_id uuid, professional_id uuid, plan_id uuid,
  amount numeric, ciclo text, next_due_date date
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.plan_subscriptions ps
     set renewal_claimed_at = now()
   where ps.id in (
     select id from public.plan_subscriptions
      where status in ('active', 'overdue')
        and next_due_date is not null
        and next_due_date <= current_date
        and (renewal_claimed_at is null or renewal_claimed_at < now() - interval '1 hour')
      order by next_due_date
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
      for update skip locked
   )
  returning ps.id, ps.professional_id, ps.plan_id, ps.amount, ps.ciclo, ps.next_due_date;
end;
$$;

revoke all on function public.listar_assinaturas_prontas_para_renovar(integer) from public, anon, authenticated;
grant execute on function public.listar_assinaturas_prontas_para_renovar(integer) to service_role;

comment on function public.listar_assinaturas_prontas_para_renovar(integer) is
  'Reserva (renewal_claimed_at = now()) as assinaturas prontas ANTES de qualquer chamada ao Asaas — mesmo raciocínio de listar_repasses_prontos.';

-- ---------------------------------------------------------------------------
-- 3. Cobrança do ciclo N+1 — mesma forma de preparar_cobranca_assinatura,
--    mas para o caminho automático (que PRECISA aceitar 'active'/'overdue',
--    diferente da entrada manual do profissional, que bloqueia 'active' de
--    propósito para não gerar cobrança fora de ciclo por engano).
-- ---------------------------------------------------------------------------
create or replace function public.preparar_cobranca_renovacao(
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
  if v_sub.status not in ('active', 'overdue') then
    raise exception 'Assinatura não está em ciclo cobrável.';
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

revoke all on function public.preparar_cobranca_renovacao(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.preparar_cobranca_renovacao(uuid, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Cron: dispara o worker uma vez por dia (next_due_date é `date`, não
--    `timestamptz` — não há granularidade menor que um dia aqui).
--    Mesmo padrão vault + pg_net de disparar_processador_repasses
--    (20260819160000): no-op silencioso se os secrets não estiverem
--    configurados.
-- ---------------------------------------------------------------------------
create or replace function public.disparar_worker_renovacao_assinaturas()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'assinaturas_renovacao_dispatch_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'assinaturas_renovacao_worker_key';

  if v_url is null or v_key is null then
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object('origem', 'pg_cron'),
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    timeout_milliseconds := 15000
  );
end;
$$;

revoke all on function public.disparar_worker_renovacao_assinaturas() from public, anon, authenticated;

select cron.schedule(
  'friohub-assinaturas-renovacao',
  '0 6 * * *',
  'select public.disparar_worker_renovacao_assinaturas();'
);
