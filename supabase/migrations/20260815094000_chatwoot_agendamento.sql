-- ============================================================================
-- Chatwoot — disparo do worker e observabilidade
--
-- O projeto não tinha nenhum consumidor externo de fila: `notification_outbox`
-- nasceu pronta e ficou parada porque nada a lia. O que faltava era quem
-- acordasse o worker. `pg_cron` já roda cinco jobs aqui, mas todos chamam SQL;
-- para acordar uma Edge Function é preciso sair do banco por HTTP, e é isso que
-- `pg_net` faz.
--
-- ---------------------------------------------------------------------------
-- Onde ficam os segredos
-- ---------------------------------------------------------------------------
-- No Vault (`vault.create_secret`), não nesta migration e não numa GUC. Uma
-- migration é versionada em git; segredo em migration é segredo publicado.
--
-- Configurar UMA vez, por quem opera (não é passo de deploy automatizado):
--
--   select vault.create_secret(
--     'https://<ref>.supabase.co/functions/v1/chatwoot-dispatch',
--     'chatwoot_dispatch_url', 'URL da Edge Function de despacho');
--   select vault.create_secret(
--     '<service_role_key>', 'chatwoot_worker_key', 'Chave usada pelo cron para acordar o worker');
--
-- Enquanto os dois não existirem, `disparar_worker_chatwoot()` é um no-op
-- silencioso. Isso é deliberado: o cron roda de minuto em minuto desde que esta
-- migration sobe, e falhar ruidosamente por falta de configuração encheria o
-- log de erro sem que nada estivesse quebrado de verdade.
--
-- Reversibilidade: `cron.unschedule('friohub-chatwoot-dispatch')` para o
-- disparo na hora, sem tocar em dado nenhum.
-- ============================================================================

/* Já vem habilitada na imagem local do Supabase; o `if not exists` existe para
   o ambiente hospedado, onde a extensão precisa ser ligada explicitamente. */
create extension if not exists pg_net with schema extensions;

create or replace function public.disparar_worker_chatwoot()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'chatwoot_dispatch_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'chatwoot_worker_key';

  -- Ainda não configurado: nada a fazer, e nada a alarmar.
  if v_url is null or v_key is null then
    return;
  end if;

  /* http_post é assíncrono — devolve o id da requisição e não bloqueia o cron.
     A resposta não interessa aqui: quem garante a entrega é o `status` da
     outbox, que o próprio worker fecha. Se a chamada se perder, a linha
     continua reservável no minuto seguinte. */
  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object('origem', 'pg_cron'),
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    timeout_milliseconds := 5000
  );
end;
$$;

revoke all on function public.disparar_worker_chatwoot() from public, anon, authenticated;

select cron.schedule(
  'friohub-chatwoot-dispatch',
  '* * * * *',
  'select public.disparar_worker_chatwoot();'
);

-- ---------------------------------------------------------------------------
-- Devolver à fila o que ficou reservado e não voltou
--
-- `reservar_notificacoes_whatsapp` marca `processing` e o worker fecha em
-- `sent` ou `failed`. Se a Edge Function morre no meio (timeout, deploy), a
-- linha fica `processing` para sempre e some da fila em silêncio — o pior tipo
-- de falha, porque o health check de `pending/failed` não a enxerga.
--
-- `attempts` já foi consumido na reserva, então isto não é um laço infinito:
-- depois de algumas voltas a linha estabiliza em `failed` com recuo.
-- ---------------------------------------------------------------------------
create or replace function public.destravar_notificacoes_presas()
returns integer
language sql
security definer
set search_path = public
as $$
  with destravadas as (
    update public.notification_outbox
       set status = 'failed',
           locked_at = null,
           last_error = coalesce(last_error, 'reserva expirada sem conclusão')
     where status = 'processing'
       and locked_at < now() - interval '10 minutes'
    returning 1
  )
  select count(*)::integer from destravadas;
$$;

revoke all on function public.destravar_notificacoes_presas() from public, anon, authenticated;

select cron.schedule(
  'friohub-chatwoot-destravar',
  '*/10 * * * *',
  'select public.destravar_notificacoes_presas();'
);

-- ---------------------------------------------------------------------------
-- Health check ganha os dois componentes do Chatwoot
--
-- Função reescrita inteira porque é `create or replace`; o que muda são os dois
-- blocos novos no fim, antes da consolidação. Limiares no mesmo espírito dos
-- existentes: qualquer atraso é `degraded`, volume é `down`.
-- ---------------------------------------------------------------------------
create or replace function public.avaliar_saude_sistema()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid := gen_random_uuid();
  v_count bigint;
  v_age_minutes numeric;
  v_overall text := 'healthy';
begin
  if not pg_try_advisory_xact_lock(hashtextextended('friohub:system-health', 0)) then
    select id into v_run_id from public.system_health_runs order by started_at desc limit 1;
    return v_run_id;
  end if;

  insert into public.system_health_runs (id, status) values (v_run_id, 'healthy');
  insert into public.system_health_checks (run_id, component, status, observed_value, threshold)
  values (v_run_id, 'database', 'healthy', 1, 1);

  select count(*) into v_count from public.notification_outbox
   where status in ('pending', 'failed') and available_at < now() - interval '15 minutes';
  insert into public.system_health_checks (run_id, component, status, observed_value, threshold)
  values (v_run_id, 'notification_outbox', case when v_count >= 100 then 'down' when v_count > 0 then 'degraded' else 'healthy' end, v_count, 0);

  select count(*) into v_count from public.payment_gateway_events
   where processing_status in ('pending', 'error') and received_at < now() - interval '15 minutes';
  insert into public.system_health_checks (run_id, component, status, observed_value, threshold)
  values (v_run_id, 'payment_webhooks', case when v_count >= 20 then 'down' when v_count > 0 then 'degraded' else 'healthy' end, v_count, 0);

  select extract(epoch from (now() - max(started_at))) / 60 into v_age_minutes
    from public.financial_reconciliation_runs where status = 'completed';
  insert into public.system_health_checks (run_id, component, status, observed_value, threshold, details)
  values (v_run_id, 'financial_reconciliation',
    case when v_age_minutes is null or v_age_minutes > 180 then 'down' when v_age_minutes > 90 then 'degraded' else 'healthy' end,
    v_age_minutes, 90, jsonb_build_object('unit', 'minutes_since_last_success'));

  select count(*) into v_count from public.operational_cases
   where status = 'open' and priority = 'critical';
  insert into public.system_health_checks (run_id, component, status, observed_value, threshold)
  values (v_run_id, 'marketplace_sla', case when v_count >= 10 then 'down' when v_count > 0 then 'degraded' else 'healthy' end, v_count, 0);

  select count(*) into v_count from public.pmoc_visits
   where status = 'planned' and due_date < current_date;
  insert into public.system_health_checks (run_id, component, status, observed_value, threshold)
  values (v_run_id, 'pmoc_visits', case when v_count >= 20 then 'down' when v_count > 0 then 'degraded' else 'healthy' end, v_count, 0);

  /* Webhook do Chatwoot parado significa mensagem que o cliente mandou e o
     profissional não vê — é falha de produto, não de infraestrutura. */
  select count(*) into v_count from public.chatwoot_events
   where processing_status in ('pending', 'error') and received_at < now() - interval '15 minutes';
  insert into public.system_health_checks (run_id, component, status, observed_value, threshold)
  values (v_run_id, 'chatwoot_webhooks', case when v_count >= 20 then 'down' when v_count > 0 then 'degraded' else 'healthy' end, v_count, 0);

  select count(*) into v_count from public.notification_outbox
   where whatsapp_allowed and status in ('pending', 'failed')
     and available_at < now() - interval '15 minutes';
  insert into public.system_health_checks (run_id, component, status, observed_value, threshold)
  values (v_run_id, 'chatwoot_whatsapp', case when v_count >= 100 then 'down' when v_count > 0 then 'degraded' else 'healthy' end, v_count, 0);

  select case when bool_or(status = 'down') then 'down'
                   when bool_or(status = 'degraded') then 'degraded'
                   else 'healthy' end
    into v_overall from public.system_health_checks where run_id = v_run_id;
  update public.system_health_runs set status = v_overall, finished_at = now() where id = v_run_id;

  delete from public.system_health_runs where started_at < now() - interval '90 days';
  delete from public.rate_limit_buckets where expires_at < now() - interval '1 day';
  return v_run_id;
end;
$$;

revoke all on function public.avaliar_saude_sistema() from public, anon, authenticated;
