begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(20);

select has_table('public', 'notification_preferences', 'preferências de notificação existem');
select has_table('public', 'notification_outbox', 'outbox transacional existe');
select has_table('public', 'quote_request_events', 'orçamento possui histórico');
select has_table('public', 'job_events', 'serviço possui histórico');
select has_table('public', 'operational_cases', 'fila operacional existe');
select has_table('public', 'conversation_contexts', 'chat registra contexto');
select has_table('public', 'job_appointments', 'serviço possui agendamento');

select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('notification_outbox', 'quote_request_events', 'job_events', 'operational_cases', 'job_appointments')
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ),
  'tabelas operacionais críticas não aceitam escrita direta pela Data API'
);

select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('quote_requests', 'quote_request_targets')
       and cmd = 'UPDATE'
  ),
  'cancelamento e recusa não usam update direto'
);

select is(
  (select prosecdef from pg_proc where oid = 'public.cancelar_pedido_orcamento(uuid,text)'::regprocedure),
  true,
  'cancelamento auditado é SECURITY DEFINER'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.recusar_pedido_orcamento(uuid,text)'::regprocedure),
  true,
  'recusa auditada é SECURITY DEFINER'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.abrir_conversa_contextual(uuid,uuid,uuid)'::regprocedure),
  true,
  'abertura contextual valida os participantes no banco'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.propor_agendamento(uuid,timestamp with time zone,timestamp with time zone,text)'::regprocedure),
  true,
  'proposta de agenda é SECURITY DEFINER'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.responder_agendamento(uuid,boolean,text)'::regprocedure),
  true,
  'resposta da agenda é SECURITY DEFINER'
);

select ok(
  not has_function_privilege('anon', 'public.enqueue_notification(uuid,text,text,uuid,jsonb,text,timestamp with time zone)', 'execute')
  and not has_function_privilege('authenticated', 'public.enqueue_notification(uuid,text,text,uuid,jsonb,text,timestamp with time zone)', 'execute'),
  'papéis da Data API não executam enqueue interno'
);
select ok(
  not has_function_privilege('authenticated', 'public.processar_operacao_marketplace()', 'execute'),
  'usuário autenticado não executa o cron operacional'
);
select ok(
  has_function_privilege('authenticated', 'public.cancelar_pedido_orcamento(uuid,text)', 'execute'),
  'cliente autenticado pode chamar o comando de cancelamento'
);
select ok(
  has_function_privilege('authenticated', 'public.propor_agendamento(uuid,timestamp with time zone,timestamp with time zone,text)', 'execute'),
  'participante autenticado pode chamar proposta de agenda'
);

select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'notification_outbox'
       and indexname = 'idx_notification_outbox_pending'
       and indexdef ilike '%where%'
  ),
  'consulta da outbox pendente usa índice parcial'
);

select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'job_appointments'
       and indexname = 'uq_job_appointment_active'
       and indexdef ilike '%unique%where%'
  ),
  'cada serviço possui no máximo um agendamento ativo'
);

select * from finish();
rollback;
