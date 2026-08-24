-- ============================================================================
-- Pagamento e assinatura passam a notificar (in-app)
-- ============================================================================
--
-- Hoje pagamento recebido e assinatura vencida não notificam NINGUÉM — nem
-- in-app, nem WhatsApp, nem e-mail. `processar_evento_gateway` só atualiza
-- tabelas financeiras.
--
-- Entra por TRIGGER NOVO, não editando `processar_evento_gateway` — aquela
-- função já foi reescrita 5 vezes, tem ~150+ linhas cobrindo todos os
-- eventos do Asaas, e é o tipo de função financeira crítica onde reproduzir
-- o corpo inteiro errado por engano custa caro. Um trigger reagindo à
-- mudança de estado (mesmo padrão de `solicita_revalidacao_professional_relacionado`,
-- que também é trigger à parte, não foi enfiado dentro de
-- `protege_confianca_professional`) é mais seguro e não toca uma linha do
-- que já existe.
--
-- WhatsApp/e-mail ainda não têm canal pronto pra esses dois eventos (sem
-- template aprovado na Meta, sem domínio pra e-mail) — por isso os dois
-- inserts abaixo fixam `whatsapp_allowed=false, email_allowed=false`, mesmo
-- padrão que `purchase_order_created/updated` já usa por causa disso
-- (20260818110000_notificacoes_purchase_order.sql). QUANDO o WhatsApp tiver
-- template aprovado pra estes dois eventos, trocar o `false` fixo por
-- leitura de `notification_preferences.whatsapp_*`, igual o resto do
-- sistema já faz — não antes, ou cai no loop de retry documentado em
-- `chatwoot-dispatch` pra event_type sem template.

alter table public.notification_outbox
  drop constraint notification_outbox_event_type_check;
alter table public.notification_outbox
  add constraint notification_outbox_event_type_check check (event_type in (
    'quote_request_received', 'quote_received', 'quote_accepted',
    'quote_cancelled', 'quote_declined', 'new_message', 'job_updated',
    'appointment_proposed', 'appointment_confirmed', 'appointment_cancelled',
    'appointment_reminder', 'pmoc_offered', 'pmoc_activated', 'pmoc_visit_due',
    'purchase_order_created', 'purchase_order_updated',
    'payment_received', 'subscription_overdue'
  ));

alter table public.notification_outbox
  drop constraint notification_outbox_aggregate_type_check;
alter table public.notification_outbox
  add constraint notification_outbox_aggregate_type_check check (aggregate_type in (
    'quote_request', 'job', 'conversation', 'appointment', 'pmoc_plan', 'pmoc_visit',
    'purchase_order', 'plan_subscription'
  ));

create or replace function public.categoria_notificacao(p_event_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_event_type = 'quote_request_received' then 'quote_requests'
    when p_event_type in ('quote_received', 'quote_accepted', 'quote_cancelled', 'quote_declined') then 'quotes'
    when p_event_type = 'new_message' then 'messages'
    when p_event_type in (
      'appointment_proposed', 'appointment_confirmed',
      'appointment_cancelled', 'appointment_reminder', 'pmoc_visit_due'
    ) then 'reminders'
    -- Sem categoria de "financeiro" própria ainda — cai no toggle já
    -- existente de "atualizações do serviço", mesmo raciocínio de
    -- purchase_order_* (que também não ganharam categoria dedicada).
    when p_event_type in ('payment_received', 'subscription_overdue') then 'job_updates'
    else 'job_updates'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Pagamento do serviço confirmado → notifica o profissional
-- ---------------------------------------------------------------------------
create or replace function public.notificar_pagamento_recebido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_profissional_id uuid;
begin
  if new.status = 'received' and old.status is distinct from 'received' and new.order_id is not null then
    select j.id, j.profissional_id into v_job_id, v_profissional_id
      from public.orders o
      join public.jobs j on j.id = o.job_id
     where o.id = new.order_id;

    if v_profissional_id is not null then
      insert into public.notification_outbox (
        recipient_id, event_type, aggregate_type, aggregate_id,
        payload, dedupe_key, inapp_allowed, email_allowed, whatsapp_allowed
      ) values (
        v_profissional_id, 'payment_received', 'job', v_job_id,
        jsonb_build_object('amount', new.amount, 'order_id', new.order_id),
        format('payment_received:%s', new.id),
        true, false, false
      )
      on conflict (dedupe_key) do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notificar_pagamento_recebido on public.payment_charges;
create trigger trg_notificar_pagamento_recebido
  after update of status on public.payment_charges
  for each row execute function public.notificar_pagamento_recebido();

-- ---------------------------------------------------------------------------
-- 2. Assinatura fica inadimplente → notifica o próprio profissional
-- ---------------------------------------------------------------------------
create or replace function public.notificar_assinatura_vencida()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription_id uuid;
begin
  if new.subscription_status = 'inadimplente' and old.subscription_status is distinct from 'inadimplente' then
    select id into v_subscription_id
      from public.plan_subscriptions
     where professional_id = new.id and status = 'overdue'
     order by created_at desc
     limit 1;

    -- aggregate_id é NOT NULL na outbox. Sem assinatura overdue encontrada
    -- (não deveria acontecer — processar_evento_gateway sempre marca a
    -- assinatura antes do profissional —, mas é uma notificação, não o
    -- pagamento em si: melhor pular silenciosamente do que arriscar
    -- derrubar a transação que processa o webhook do Asaas).
    if v_subscription_id is null then
      return new;
    end if;

    insert into public.notification_outbox (
      recipient_id, event_type, aggregate_type, aggregate_id,
      payload, dedupe_key, inapp_allowed, email_allowed, whatsapp_allowed
    ) values (
      new.id, 'subscription_overdue', 'plan_subscription', v_subscription_id,
      '{}'::jsonb,
      format('subscription_overdue:%s:%s', new.id, now()::date),
      true, false, false
    )
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notificar_assinatura_vencida on public.professionals;
create trigger trg_notificar_assinatura_vencida
  after update of subscription_status on public.professionals
  for each row execute function public.notificar_assinatura_vencida();
