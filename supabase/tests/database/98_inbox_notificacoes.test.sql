begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(22);

-- ---------------------------------------------------------------------------
-- Contrato de schema
-- ---------------------------------------------------------------------------
select has_column('public','notification_outbox','read_at','outbox registra leitura no app');
select has_column('public','notification_outbox','inapp_allowed','outbox registra permissão do canal app');
select has_column('public','notification_outbox','email_allowed','outbox registra permissão do canal e-mail');
select has_column('public','notification_preferences','inapp_enabled','preferências distinguem canal');
select has_function('public','marcar_notificacao_lida',array['uuid'],'marcar como lida é RPC');
select has_function('public','marcar_notificacoes_lidas',array[]::text[],'marcar todas como lidas é RPC');

/* A escrita direta pela Data API continua proibida nesta tabela; ler as
   próprias notificações é o único acesso novo. */
select ok(
  not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='notification_outbox'
       and cmd in ('INSERT','UPDATE','DELETE','ALL')
  ),
  'inbox não abriu escrita direta na outbox'
);
select ok(
  exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='notification_outbox'
       and policyname='notification_outbox_destinatario_read'
  ),
  'destinatário possui política de leitura'
);

-- ---------------------------------------------------------------------------
-- Categorização
-- ---------------------------------------------------------------------------
select is(public.categoria_notificacao('new_message'),'messages','mensagem cai em messages');
select is(public.categoria_notificacao('appointment_reminder'),'reminders','lembrete de agenda cai em reminders');
select is(public.categoria_notificacao('pmoc_visit_due'),'reminders','visita PMOC cai em reminders');
select is(public.categoria_notificacao('quote_accepted'),'quotes','aceite de proposta cai em quotes');
select is(public.categoria_notificacao('job_updated'),'job_updates','evento sem categoria própria cai em job_updates');

-- ---------------------------------------------------------------------------
-- Cenário
-- ---------------------------------------------------------------------------
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('98000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','inbox-sem-email@teste.local','',now(),now()),
('98000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','inbox-mudo@teste.local','',now(),now()),
('98000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','inbox-curioso@teste.local','',now(),now());

/* Usuário 1 desligou o e-mail, mas não o app. É o caso que motivou a migration:
   antes, desligar e-mail apagava a notificação do produto inteiro. */
insert into public.notification_preferences(user_id,email_enabled,inapp_enabled)
values ('98000000-0000-0000-0000-000000000001',false,true);

-- Usuário 2 desligou os dois canais.
insert into public.notification_preferences(user_id,email_enabled,inapp_enabled)
values ('98000000-0000-0000-0000-000000000002',false,false);

select public.enqueue_notification(
  '98000000-0000-0000-0000-000000000001','new_message','conversation',
  gen_random_uuid(),'{}'::jsonb,'teste-inbox-1'
);
select public.enqueue_notification(
  '98000000-0000-0000-0000-000000000002','new_message','conversation',
  gen_random_uuid(),'{}'::jsonb,'teste-inbox-2'
);

select is(
  (select count(*)::integer from public.notification_outbox where dedupe_key='teste-inbox-1'),
  1,
  'e-mail desligado não impede o registro do evento'
);
select is(
  (select email_allowed from public.notification_outbox where dedupe_key='teste-inbox-1'),
  false,
  'linha marca que o canal e-mail está bloqueado'
);
select is(
  (select inapp_allowed from public.notification_outbox where dedupe_key='teste-inbox-1'),
  true,
  'linha permanece visível para o inbox'
);
select is(
  (select count(*)::integer from public.notification_outbox where dedupe_key='teste-inbox-2'),
  0,
  'com os dois canais desligados nada é gravado'
);

-- ---------------------------------------------------------------------------
-- Isolamento entre usuários e marcação de leitura
-- ---------------------------------------------------------------------------
set local role authenticated;

select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000003',true);
select is(
  (select count(*)::integer from public.notification_outbox where dedupe_key='teste-inbox-1'),
  0,
  'um usuário não enxerga a notificação de outro'
);
select ok(
  not public.marcar_notificacao_lida(
    (select id from public.notification_outbox where dedupe_key='teste-inbox-1')
  ),
  'um usuário não marca como lida a notificação de outro'
);

select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000001',true);
select is(
  (select count(*)::integer from public.notification_outbox where dedupe_key='teste-inbox-1'),
  1,
  'destinatário enxerga a própria notificação'
);
select ok(
  public.marcar_notificacao_lida(
    (select id from public.notification_outbox where dedupe_key='teste-inbox-1')
  ),
  'destinatário marca a própria notificação como lida'
);
/* Segunda chamada devolve false porque nada foi atualizado — é assim que
   `read_at` preserva o instante da primeira leitura. */
select ok(
  not public.marcar_notificacao_lida(
    (select id from public.notification_outbox where dedupe_key='teste-inbox-1')
  ),
  'marcar de novo não reescreve a data da primeira leitura'
);

select * from finish();
rollback;
