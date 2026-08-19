-- ============================================================================
-- Repasse automático — ligação real com o Asaas Transfers
--
-- Confirmado em sandbox (POST /v3/transfers com pixAddressKey de terceiro,
-- fora da conta Asaas de origem) que a API aceita transferência de fato: veio
-- 200, `operationType: "PIX"`, `status: "PENDING"`. Os eventos de webhook de
-- transferência documentados pelo Asaas são: TRANSFER_CREATED, TRANSFER_PENDING,
-- TRANSFER_IN_BANK_PROCESSING, TRANSFER_BLOCKED, TRANSFER_DONE, TRANSFER_FAILED,
-- TRANSFER_CANCELLED — batem 1:1 com o enum que `payment_transfers.status` já
-- tinha (pending_creation/pending/confirmed/failed/cancelled), sem precisar
-- mexer no CHECK.
--
-- RISCO DE PAGAMENTO DUPLICADO, registrado aqui de propósito: diferente de
-- cobrança (onde `preparar_cobranca_order` é idempotente ANTES de chamar o
-- gateway), uma transferência que já foi enviada ao Asaas moveu dinheiro de
-- verdade — não existe "tentar de novo com segurança" se a Edge Function
-- morrer entre enviar e salvar a resposta. Por isso `listar_repasses_prontos`
-- RESERVA a linha (pending_creation -> pending) ANTES de qualquer chamada
-- HTTP, e uma falha na chamada (`marcar_repasse_falho`) NUNCA devolve a linha
-- pra fila — vira `failed`, com investigação manual. É pior travar um repasse
-- do que arriscar mandar duas vezes.
-- ============================================================================

alter table public.financial_journals
  drop constraint if exists financial_journals_journal_type_check;
alter table public.financial_journals
  add constraint financial_journals_journal_type_check
  check (journal_type in ('payment_received', 'payment_reversed', 'manual_adjustment', 'transfer_sent'));

alter table public.payment_gateway_events
  add column if not exists kind text not null default 'payment' check (kind in ('payment', 'transfer')),
  add column if not exists gateway_transfer_id text;

create index if not exists idx_payment_gateway_events_transfer
  on public.payment_gateway_events (gateway, gateway_transfer_id)
  where kind = 'transfer';

-- ---------------------------------------------------------------------------
-- 1. Reserva atômica: claim antes de qualquer chamada HTTP
-- ---------------------------------------------------------------------------
create or replace function public.listar_repasses_prontos(p_limit integer default 20)
returns table (
  id uuid, job_id uuid, amount numeric, pix_key text, pix_key_type text
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
  returning t.id, t.job_id, t.amount, t.pix_key, t.pix_key_type;
end;
$$;

revoke all on function public.listar_repasses_prontos(integer) from public, anon, authenticated;
grant execute on function public.listar_repasses_prontos(integer) to service_role;

comment on function public.listar_repasses_prontos(integer) is
  'Reserva (pending_creation -> pending) os repasses prontos ANTES de qualquer chamada ao '
  'Asaas — uma linha reservada nunca volta pra fila automaticamente, mesmo se a Edge '
  'Function falhar depois. Evita reenviar PIX que talvez já tenha sido enviado.';

-- ---------------------------------------------------------------------------
-- 2. Vincula a resposta do Asaas — chamado logo após POST /v3/transfers ter
--    respondido com sucesso.
-- ---------------------------------------------------------------------------
create or replace function public.vincular_transferencia_gateway(
  p_transfer_id uuid,
  p_gateway_transfer_id text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status_local text;
begin
  v_status_local := case p_status
    when 'DONE' then 'confirmed'
    when 'FAILED' then 'failed'
    when 'CANCELLED' then 'cancelled'
    when 'BLOCKED' then 'failed'
    else 'pending'
  end;

  update public.payment_transfers
     set gateway_transfer_id = p_gateway_transfer_id,
         status = v_status_local,
         confirmed_at = case when v_status_local = 'confirmed' then coalesce(confirmed_at, now()) else confirmed_at end,
         failed_at    = case when v_status_local = 'failed'    then coalesce(failed_at, now())    else failed_at end
   where id = p_transfer_id
     and status = 'pending';

  if not found then
    raise exception 'Repasse não está reservado para vinculação — status inesperado.';
  end if;
end;
$$;

revoke all on function public.vincular_transferencia_gateway(uuid, text, text) from public, anon, authenticated;
grant execute on function public.vincular_transferencia_gateway(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. A chamada ao Asaas falhou antes de qualquer resposta útil — a linha fica
--    `failed`, e NUNCA volta sozinha pra fila (ver risco de duplicidade acima).
-- ---------------------------------------------------------------------------
create or replace function public.marcar_repasse_falho(p_transfer_id uuid, p_erro text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.payment_transfers
     set status = 'failed', failed_at = now(), last_error = left(coalesce(p_erro, 'Falha desconhecida.'), 2000)
   where id = p_transfer_id and status = 'pending';
$$;

revoke all on function public.marcar_repasse_falho(uuid, text) from public, anon, authenticated;
grant execute on function public.marcar_repasse_falho(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Webhook de transferência — mesmo desenho do de pagamento (grava cru,
--    processa depois), função própria para não mexer no par já testado de
--    payment_charges.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_evento_gateway_transferencia(
  p_gateway text,
  p_gateway_event_id text,
  p_event_type text,
  p_gateway_transfer_id text,
  p_payload jsonb,
  p_occurred_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_gateway <> 'asaas' then raise exception 'Gateway não suportado.'; end if;
  if nullif(btrim(p_gateway_event_id), '') is null then raise exception 'Evento sem identificador.'; end if;

  insert into public.payment_gateway_events (
    gateway, gateway_event_id, event_type, kind, gateway_transfer_id, payload, occurred_at
  ) values (
    p_gateway, btrim(p_gateway_event_id), p_event_type, 'transfer',
    nullif(btrim(p_gateway_transfer_id), ''), coalesce(p_payload, '{}'::jsonb), coalesce(p_occurred_at, now())
  )
  on conflict (gateway, gateway_event_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.payment_gateway_events
     where gateway = p_gateway and gateway_event_id = btrim(p_gateway_event_id);
  end if;
  return v_id;
end;
$$;

revoke all on function public.registrar_evento_gateway_transferencia(text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.registrar_evento_gateway_transferencia(text, text, text, text, jsonb, timestamptz)
  to service_role;

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

  case v_event.event_type
    when 'TRANSFER_CREATED', 'TRANSFER_PENDING', 'TRANSFER_IN_BANK_PROCESSING' then
      if v_transfer.status = 'pending' then
        null; -- já é o estado corrente, nada a fazer
      end if;

    when 'TRANSFER_DONE' then
      if v_transfer.status <> 'confirmed' then
        select a.charge_id into v_charge_id from public.payment_allocations a where a.id = v_transfer.allocation_id;

        v_lines := jsonb_build_array(
          jsonb_build_object('account_code', 'professional_payable', 'direction', 'debit',
            'amount', v_transfer.amount, 'beneficiary_id', v_transfer.beneficiary_id),
          jsonb_build_object('account_code', 'gateway_clearing', 'direction', 'credit', 'amount', v_transfer.amount)
        );
        /* `registrar_lancamento_financeiro` tem DUAS assinaturas coexistindo
           hoje (a original de 9 parâmetros e uma de 10, com
           p_subscription_id, criada por 20260818140000 sem dropar a
           anterior — mesma armadilha de "duas funções ambíguas" que outras
           partes do projeto evitam com `drop function if exists`). Chamar
           com literais sem tipo (como faríamos com só 9 argumentos crus)
           quebra com "function ... is not unique". Passar os 10 argumentos
           aqui força o match exato na assinatura nova, sem ambiguidade —
           não mexe na função em si, que é uma dívida técnica pré-existente,
           fora do escopo desta migration. */
        perform public.registrar_lancamento_financeiro(
          v_transfer.order_id, v_charge_id, 'transfer_sent',
          format('gateway-transfer-done:%s:%s', v_event.gateway, v_event.gateway_transfer_id),
          v_event.gateway_event_id, 'Repasse ao profissional confirmado pelo gateway',
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

-- `processar_eventos_gateway_pendentes` passa a atender os dois tipos —
-- mesma assinatura, só o corpo muda, então `create or replace` é seguro aqui.
create or replace function public.processar_eventos_gateway_pendentes(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_count integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('friohub:gateway-events', 0)) then
    return 0;
  end if;

  for v_event in
    select id, kind from public.payment_gateway_events
     where processing_status in ('pending', 'error')
       and attempts < 10
     order by received_at
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
     for update skip locked
  loop
    if v_event.kind = 'transfer' then
      perform public.processar_evento_gateway_transferencia(v_event.id);
    else
      perform public.processar_evento_gateway(v_event.id);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Acorda o processador de repasses via pg_net — mesmo padrão do worker do
--    Chatwoot (20260815094000). Segredos vivem no Vault, não em migration:
--
--   select vault.create_secret(
--     'https://<ref>.supabase.co/functions/v1/asaas-processar-repasses',
--     'repasses_dispatch_url', 'URL da Edge Function de repasses');
--   select vault.create_secret(
--     '<service_role_key>', 'repasses_worker_key', 'Chave usada pelo cron para acordar o worker de repasses');
--
--   Sem os dois configurados, a função é um no-op silencioso — mesma razão do
--   Chatwoot: o cron já roda a cada 15 minutos desde que esta migration sobe.
-- ---------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

create or replace function public.disparar_processador_repasses()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'repasses_dispatch_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'repasses_worker_key';

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

revoke all on function public.disparar_processador_repasses() from public, anon, authenticated;

select cron.schedule(
  'friohub-repasses-dispatch',
  '*/15 * * * *',
  'select public.disparar_processador_repasses();'
);

select cron.schedule(
  'friohub-repasses-eventos-pendentes',
  '*/5 * * * *',
  'select public.processar_eventos_gateway_pendentes();'
);
