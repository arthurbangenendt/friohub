-- ============================================================================
-- Notificação do ciclo de vida do repasse (purchase_orders)
--
-- Hoje nenhuma ponta é avisada: a distribuidora só descobre pedido novo
-- entrando manualmente em /painel/distribuidora/pedidos, e cliente/profissional
-- não sabem quando ela avança o status. Lacuna simétrica, corrigida nos dois
-- sentidos de uma vez, mesmo padrão de trigger já usado em `jobs`
-- (`notifica_job_criado`/`notifica_job_atualizado`, 20260813170000).
--
-- NÃO passa por `enqueue_notification`: essa função decide o canal a partir de
-- `notification_preferences`, com WhatsApp ligado por padrão quando não há
-- preferência salva. Um event_type sem template em TEMPLATE_POR_EVENTO
-- (supabase/functions/chatwoot-dispatch) falha em loop de retry silencioso —
-- garantido de acontecer aqui, já que não há template aprovado na Meta pra
-- isso ainda. Por isso os dois eventos gravam direto na outbox com
-- `whatsapp_allowed = false, email_allowed = false`: "você tem pedido novo pra
-- despachar" é aviso operacional obrigatório, não preferência.
-- ============================================================================

alter table public.notification_outbox
  drop constraint notification_outbox_event_type_check;
alter table public.notification_outbox
  add constraint notification_outbox_event_type_check check (event_type in (
    'quote_request_received', 'quote_received', 'quote_accepted',
    'quote_cancelled', 'quote_declined', 'new_message', 'job_updated',
    'appointment_proposed', 'appointment_confirmed', 'appointment_cancelled',
    'appointment_reminder', 'pmoc_offered', 'pmoc_activated', 'pmoc_visit_due',
    'purchase_order_created', 'purchase_order_updated'
  ));

alter table public.notification_outbox
  drop constraint notification_outbox_aggregate_type_check;
alter table public.notification_outbox
  add constraint notification_outbox_aggregate_type_check check (aggregate_type in (
    'quote_request', 'job', 'conversation', 'appointment', 'pmoc_plan', 'pmoc_visit',
    'purchase_order'
  ));

-- ---------------------------------------------------------------------------
-- 1. Distribuidora avisada de pedido novo
-- ---------------------------------------------------------------------------
create or replace function public.notifica_purchase_order_criada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  select o.job_id into v_job_id from public.orders o where o.id = new.order_id;

  insert into public.notification_outbox (
    recipient_id, event_type, aggregate_type, aggregate_id,
    payload, dedupe_key, inapp_allowed, email_allowed, whatsapp_allowed
  ) values (
    new.distributor_id, 'purchase_order_created', 'purchase_order', new.id,
    jsonb_build_object('job_id', v_job_id),
    format('po-created:%s', new.id),
    true, false, false
  )
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

create trigger trg_purchase_order_created_notification
  after insert on public.purchase_orders
  for each row execute function public.notifica_purchase_order_criada();

-- ---------------------------------------------------------------------------
-- 2. Cliente e profissional avisados quando a distribuidora avança o repasse
-- ---------------------------------------------------------------------------
create or replace function public.notifica_purchase_order_atualizada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id     uuid;
  v_cliente_id uuid;
  v_prof_id    uuid;
  v_distribuidora text;
  v_payload jsonb;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select j.id, j.cliente_id, j.profissional_id
    into v_job_id, v_cliente_id, v_prof_id
    from public.orders o
    join public.jobs j on j.id = o.job_id
   where o.id = new.order_id;

  select d.razao_social into v_distribuidora
    from public.distributors d where d.id = new.distributor_id;

  v_payload := jsonb_build_object('job_id', v_job_id, 'status_novo', new.status, 'distribuidora', v_distribuidora);

  insert into public.notification_outbox (
    recipient_id, event_type, aggregate_type, aggregate_id,
    payload, dedupe_key, inapp_allowed, email_allowed, whatsapp_allowed
  ) values
    (v_cliente_id, 'purchase_order_updated', 'purchase_order', new.id,
     v_payload, format('po-status:%s:%s:%s', new.id, new.status, v_cliente_id), true, false, false),
    (v_prof_id, 'purchase_order_updated', 'purchase_order', new.id,
     v_payload, format('po-status:%s:%s:%s', new.id, new.status, v_prof_id), true, false, false)
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

create trigger trg_purchase_order_status_notification
  after update of status on public.purchase_orders
  for each row execute function public.notifica_purchase_order_atualizada();
