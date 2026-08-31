-- ============================================================================
-- Chatwoot — worker de sincronização de PII pós-handoff
--
-- `pii_liberado_para_chatwoot()` e `marcar_pii_sincronizado_chatwoot()` existem
-- desde 20260815090000, cobertas por teste, mas sem nenhum consumidor: nada no
-- projeto decidia QUAIS conversas checar. Esta migration fecha esse buraco —
-- mesmo desenho de disparo do 20260815094000 (pg_cron + pg_net acordando uma
-- Edge Function), aplicado a um worker novo.
--
-- ---------------------------------------------------------------------------
-- Onde ficam os segredos
-- ---------------------------------------------------------------------------
-- Reaproveita `chatwoot_worker_key` (já configurado para o dispatch de
-- WhatsApp) e soma um segredo novo no Vault, configurado UMA vez por quem
-- opera, depois do `supabase functions deploy chatwoot-pii-sync`:
--
--   select vault.create_secret(
--     'https://<ref>.supabase.co/functions/v1/chatwoot-pii-sync',
--     'chatwoot_pii_sync_url', 'URL da Edge Function de sync de PII');
--
-- Enquanto não existir, `disparar_worker_chatwoot_pii()` é no-op silencioso —
-- mesmo raciocínio do dispatch: o cron roda desde que esta migration sobe, e
-- log de erro por falta de configuração não ajuda ninguém.
--
-- Reversibilidade: `cron.unschedule('friohub-chatwoot-pii-sync')` para o
-- disparo na hora, sem tocar em dado nenhum. As duas funções SQL não têm
-- efeito colateral fora de si mesmas.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Conversas candidatas a sync de PII
--
-- Três condições: (1) a conversa já existe no Chatwoot — sem isso não há
-- contato pra atualizar; (2) o handoff já foi liberado; (3) pelo menos um dos
-- dois participantes ainda não teve PII sincronizado. A condição (3) é "pelo
-- menos um", não "os dois", porque cada participante sincroniza no próprio
-- ritmo (ex: um profissional já sincronizado por outra conversa não deve
-- travar o sync do cliente desta).
-- ---------------------------------------------------------------------------
create or replace function public.conversas_pendentes_sync_pii(p_limit integer default 20)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
    from public.conversations c
   where c.chatwoot_conversation_id is not null
     and public.handoff_liberado(c.id)
     and exists (
       select 1 from public.chatwoot_identities ci
        where ci.profile_id in (c.cliente_id, c.professional_id)
          and ci.pii_synced_at is null
     )
   order by c.last_message_at
   limit p_limit;
$$;

comment on function public.conversas_pendentes_sync_pii is
  'Conversas com handoff liberado e pelo menos um participante ainda sem PII no Chatwoot. Consumida pelo worker chatwoot-pii-sync.';

revoke all on function public.conversas_pendentes_sync_pii(integer) from public, anon, authenticated;
grant execute on function public.conversas_pendentes_sync_pii(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Disparo do worker — mesmo molde de disparar_worker_chatwoot()
-- ---------------------------------------------------------------------------
create or replace function public.disparar_worker_chatwoot_pii()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'chatwoot_pii_sync_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'chatwoot_worker_key';

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
    timeout_milliseconds := 5000
  );
end;
$$;

revoke all on function public.disparar_worker_chatwoot_pii() from public, anon, authenticated;

/* A cada 5 minutos: sync de PII não é latência-crítica como mensagem — o
   handoff em si já levou dias pra liberar. */
select cron.schedule(
  'friohub-chatwoot-pii-sync',
  '*/5 * * * *',
  'select public.disparar_worker_chatwoot_pii();'
);

-- ---------------------------------------------------------------------------
-- Health check ganha o worker novo — mesmo espírito do bloco chatwoot_whatsapp
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

  select count(*) into v_count from public.chatwoot_events
   where processing_status in ('pending', 'error') and received_at < now() - interval '15 minutes';
  insert into public.system_health_checks (run_id, component, status, observed_value, threshold)
  values (v_run_id, 'chatwoot_webhooks', case when v_count >= 20 then 'down' when v_count > 0 then 'degraded' else 'healthy' end, v_count, 0);

  select count(*) into v_count from public.notification_outbox
   where whatsapp_allowed and status in ('pending', 'failed')
     and available_at < now() - interval '15 minutes';
  insert into public.system_health_checks (run_id, component, status, observed_value, threshold)
  values (v_run_id, 'chatwoot_whatsapp', case when v_count >= 100 then 'down' when v_count > 0 then 'degraded' else 'healthy' end, v_count, 0);

  /* Backlog de sync de PII: cada conversa aqui é handoff liberado esperando
     telefone/e-mail chegar ao contato do Chatwoot — atraso não perde
     mensagem, mas atrasa a equipe de suporte enxergar quem é quem. */
  select count(*) into v_count from public.conversas_pendentes_sync_pii(1000);
  insert into public.system_health_checks (run_id, component, status, observed_value, threshold)
  values (v_run_id, 'chatwoot_pii_sync', case when v_count >= 50 then 'down' when v_count > 0 then 'degraded' else 'healthy' end, v_count, 0);

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
