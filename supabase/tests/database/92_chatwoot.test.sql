begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(44);

-- ---------------------------------------------------------------------------
-- Fixture
--
-- Três pares distintos porque `conversations` é unique por (cliente,
-- profissional) e os testes de handoff não podem contaminar um ao outro: cada
-- um precisa da própria contagem de dias.
-- ---------------------------------------------------------------------------
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('92000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cw-cliente-a@teste.local','',now(),now()),
('92000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cw-cliente-b@teste.local','',now(),now()),
('92000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cw-cliente-c@teste.local','',now(),now()),
('92000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cw-profissional@teste.local','',now(),now());

update public.profiles set role='cliente', nome='Cliente A' where id='92000000-0000-0000-0000-000000000001';
update public.profiles set role='cliente', nome='Cliente B' where id='92000000-0000-0000-0000-000000000002';
update public.profiles set role='cliente', nome='Cliente C' where id='92000000-0000-0000-0000-000000000003';
update public.profiles set role='profissional', nome='Profissional CW' where id='92000000-0000-0000-0000-000000000009';

insert into public.professionals(id,tipo,cidade,estado)
values ('92000000-0000-0000-0000-000000000009','autonomo','São Paulo','SP');

/* `handle_new_user` só materializa `profile_private` quando o cadastro trouxe
   telefone ou CPF no metadata — um update aqui não acharia linha nenhuma. */
insert into public.profile_private(id, telefone) values
('92000000-0000-0000-0000-000000000001','11988887777'),
('92000000-0000-0000-0000-000000000009','11977776666')
on conflict (id) do update set telefone = excluded.telefone;

insert into public.conversations(id,cliente_id,professional_id) values
('92000000-0000-0000-0000-0000000000a1','92000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000009'),
('92000000-0000-0000-0000-0000000000a2','92000000-0000-0000-0000-000000000002','92000000-0000-0000-0000-000000000009'),
('92000000-0000-0000-0000-0000000000a3','92000000-0000-0000-0000-000000000003','92000000-0000-0000-0000-000000000009');

-- ===========================================================================
-- Contrato de schema
-- ===========================================================================
select has_table('public','chatwoot_identities','mapa de identidades existe');
select has_table('public','chatwoot_events','inbox de webhooks existe');
select col_is_null('public','messages','sender_id','mensagem pode não ter autor em profiles');
select has_column('public','messages','sender_kind','mensagem declara de onde veio');
select has_column('public','messages','chatwoot_message_id','mensagem carrega o id do Chatwoot');
select has_column('public','conversations','chatwoot_conversation_id','conversa carrega o id do Chatwoot');
select has_column('public','conversations','status_atendimento','conversa espelha o status do atendimento');
select has_column('public','notification_outbox','whatsapp_allowed','outbox registra permissão do canal WhatsApp');
select has_column('public','notification_preferences','whatsapp_enabled','preferências conhecem o canal WhatsApp');

/* Mesmo contrato de `payment_gateway_events`: quem escreve é service_role por
   função definer, nunca a Data API. */
select ok(
  not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename in ('chatwoot_identities','chatwoot_events')
       and cmd in ('INSERT','UPDATE','DELETE','ALL')
  ),
  'tabelas do Chatwoot não abrem escrita pela Data API'
);
select ok(
  (select relrowsecurity from pg_class where oid='public.chatwoot_events'::regclass)
  and (select relrowsecurity from pg_class where oid='public.chatwoot_identities'::regclass),
  'RLS habilitada nas duas tabelas novas'
);

select has_function('public','espelhar_mensagem_chatwoot','espelho de mensagem é RPC');
select has_function('public','registrar_evento_chatwoot','registro de webhook é RPC');
select has_function('public','reservar_notificacoes_whatsapp','reserva da fila é RPC');
select has_function('public','pii_liberado_para_chatwoot','porta do PII é RPC');

-- ===========================================================================
-- Espelho de mensagem
-- ===========================================================================
select public.vincular_conversa_chatwoot('92000000-0000-0000-0000-0000000000a3', 7001, 22);

select public.espelhar_mensagem_chatwoot(
  7001, 500001, 'Olá, tudo bem?', 'cliente',
  '92000000-0000-0000-0000-000000000003', 'whatsapp', now()
);

select is(
  (select count(*)::integer from public.messages where conversation_id='92000000-0000-0000-0000-0000000000a3'),
  1,
  'espelho cria a mensagem'
);

-- Reentrega do webhook não pode virar mensagem duplicada.
select public.espelhar_mensagem_chatwoot(
  7001, 500001, 'Olá, tudo bem?', 'cliente',
  '92000000-0000-0000-0000-000000000003', 'whatsapp', now()
);

select is(
  (select count(*)::integer from public.messages where conversation_id='92000000-0000-0000-0000-0000000000a3'),
  1,
  'espelhar duas vezes o mesmo id não duplica'
);

select is(
  (select canal from public.conversations where id='92000000-0000-0000-0000-0000000000a3'),
  'whatsapp',
  'conversa passa a registrar o canal por onde a mensagem entrou'
);

-- Resposta da equipe FrioHub pelo painel do Chatwoot: não tem profile.
select public.espelhar_mensagem_chatwoot(
  7001, 500002, 'Aqui é o suporte FrioHub.', 'equipe',
  null, 'whatsapp', now()
);

select is(
  (select sender_id from public.messages where chatwoot_message_id=500002),
  null,
  'mensagem da equipe é gravada sem autor em profiles'
);

select throws_ok(
  $$select public.espelhar_mensagem_chatwoot(999999, 500003, 'orfã', 'cliente', null, 'app', now())$$,
  'Conversa do Chatwoot 999999 não está vinculada.',
  'espelho recusa conversa não vinculada'
);

/* Mensagem só de anexo chega com corpo vazio; sem tratamento o check de
   `body` derrubaria o evento e travaria o espelho daquela conversa. */
select public.espelhar_mensagem_chatwoot(7001, 500004, '   ', 'cliente', null, 'whatsapp', now());
select is(
  (select body from public.messages where chatwoot_message_id=500004),
  '[anexo]',
  'mensagem sem corpo vira [anexo] em vez de derrubar a fila'
);

-- ===========================================================================
-- Handoff — equipe e automação não são "um dos dois lados"
-- ===========================================================================

/* Conversa a1: quatro dias distintos, mas sempre cliente + equipe. Antes desta
   migration isso liberaria o telefone, porque `count(distinct sender_id)`
   enxergava dois autores. */
insert into public.messages(conversation_id, sender_id, sender_kind, body, created_at)
select '92000000-0000-0000-0000-0000000000a1','92000000-0000-0000-0000-000000000001','cliente','pergunta', now() - (d || ' days')::interval
  from generate_series(1,4) d;
insert into public.messages(conversation_id, sender_id, sender_kind, body, created_at)
select '92000000-0000-0000-0000-0000000000a1', null, 'equipe','resposta do suporte', now() - (d || ' days')::interval
  from generate_series(1,4) d;

select ok(
  not public.handoff_liberado('92000000-0000-0000-0000-0000000000a1'),
  'quatro dias de cliente + equipe NÃO liberam a troca de contato'
);

-- Conversa a2: os dois lados de verdade, quatro dias.
insert into public.messages(conversation_id, sender_id, sender_kind, body, created_at)
select '92000000-0000-0000-0000-0000000000a2','92000000-0000-0000-0000-000000000002','cliente','pergunta', now() - (d || ' days')::interval
  from generate_series(1,4) d;
insert into public.messages(conversation_id, sender_id, sender_kind, body, created_at)
select '92000000-0000-0000-0000-0000000000a2','92000000-0000-0000-0000-000000000009','profissional','resposta', now() - (d || ' days')::interval
  from generate_series(1,4) d;

select ok(
  public.handoff_liberado('92000000-0000-0000-0000-0000000000a2'),
  'quatro dias de cliente + profissional liberam a troca de contato'
);

-- ===========================================================================
-- Porta do PII — a mesma de revelar_contato, do lado da sincronização
-- ===========================================================================
select is(
  (select count(*)::integer from public.pii_liberado_para_chatwoot('92000000-0000-0000-0000-0000000000a2')),
  0,
  'handoff liberado mas sem consentimento não entrega telefone ao Chatwoot'
);

insert into public.conversation_contact_consent(conversation_id,user_id) values
('92000000-0000-0000-0000-0000000000a2','92000000-0000-0000-0000-000000000002');

select is(
  (select count(*)::integer from public.pii_liberado_para_chatwoot('92000000-0000-0000-0000-0000000000a2')),
  0,
  'um consentimento só não basta'
);

insert into public.conversation_contact_consent(conversation_id,user_id) values
('92000000-0000-0000-0000-0000000000a2','92000000-0000-0000-0000-000000000009');

select is(
  (select count(*)::integer from public.pii_liberado_para_chatwoot('92000000-0000-0000-0000-0000000000a2')),
  2,
  'handoff + duplo consentimento entrega os dois participantes'
);

select is(
  (select telefone from public.pii_liberado_para_chatwoot('92000000-0000-0000-0000-0000000000a2')
    where profile_id='92000000-0000-0000-0000-000000000009'),
  '11977776666',
  'telefone entregue é o do participante certo'
);

-- Conversa a1 nunca liberou handoff, então nem com consentimento sai PII.
insert into public.conversation_contact_consent(conversation_id,user_id) values
('92000000-0000-0000-0000-0000000000a1','92000000-0000-0000-0000-000000000001'),
('92000000-0000-0000-0000-0000000000a1','92000000-0000-0000-0000-000000000009');

select is(
  (select count(*)::integer from public.pii_liberado_para_chatwoot('92000000-0000-0000-0000-0000000000a1')),
  0,
  'consentimento sem handoff continua não entregando telefone'
);

-- ===========================================================================
-- Worker de sync de PII — conversas candidatas
-- ===========================================================================
select has_function('public','conversas_pendentes_sync_pii','recorte de candidatas a sync de PII é RPC');

select public.vincular_conversa_chatwoot('92000000-0000-0000-0000-0000000000a2', 7003, 22);
select public.registrar_identidade_chatwoot('92000000-0000-0000-0000-000000000002', 9002, null);
select public.registrar_identidade_chatwoot('92000000-0000-0000-0000-000000000009', 9009, 8009);

select ok(
  '92000000-0000-0000-0000-0000000000a2' in (select * from public.conversas_pendentes_sync_pii(100)),
  'conversa com handoff liberado e PII pendente entra na lista de candidatas'
);

select public.marcar_pii_sincronizado_chatwoot(array['92000000-0000-0000-0000-000000000002']::uuid[]);

select ok(
  '92000000-0000-0000-0000-0000000000a2' in (select * from public.conversas_pendentes_sync_pii(100)),
  'sincronizar só um dos dois participantes ainda mantém a conversa candidata'
);

select public.marcar_pii_sincronizado_chatwoot(array['92000000-0000-0000-0000-000000000009']::uuid[]);

select ok(
  '92000000-0000-0000-0000-0000000000a2' not in (select * from public.conversas_pendentes_sync_pii(100)),
  'sincronizar os dois participantes remove a conversa das candidatas'
);

-- ===========================================================================
-- Leitura de mensagem sem autor
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','92000000-0000-0000-0000-000000000003',true);
select public.marcar_conversa_lida('92000000-0000-0000-0000-0000000000a3');
reset role;

select is(
  (select count(*)::integer from public.messages
    where chatwoot_message_id=500002 and read_at is not null),
  1,
  'mensagem sem autor também é marcada como lida'
);

-- ===========================================================================
-- Destinatário da notificação sai de sender_kind
-- ===========================================================================
select is(
  (select count(*)::integer from public.notification_outbox
    where aggregate_id='92000000-0000-0000-0000-0000000000a3'
      and event_type='new_message'
      and recipient_id='92000000-0000-0000-0000-000000000009'),
  1,
  'mensagem do cliente notifica o profissional'
);

select is(
  (select count(*)::integer from public.notification_outbox
    where aggregate_id='92000000-0000-0000-0000-0000000000a3'
      and event_type='new_message'
      and recipient_id='92000000-0000-0000-0000-000000000003'),
  1,
  'mensagem da equipe notifica o cliente'
);

select public.vincular_conversa_chatwoot('92000000-0000-0000-0000-0000000000a1', 7002, 22);
select public.espelhar_mensagem_chatwoot(7002, 500010, 'Conversa resolvida', 'sistema', null, 'app', now());

select is(
  (select count(*)::integer from public.notification_outbox
    where aggregate_id='92000000-0000-0000-0000-0000000000a1'
      and payload->>'sender_kind' = 'sistema'),
  0,
  'mensagem de sistema não vira notificação'
);

-- ===========================================================================
-- Preferência de WhatsApp e reserva da fila
-- ===========================================================================
insert into public.notification_preferences(user_id, whatsapp_enabled)
values ('92000000-0000-0000-0000-000000000001', false)
on conflict (user_id) do update set whatsapp_enabled = false;

select public.enqueue_notification(
  '92000000-0000-0000-0000-000000000001','quote_received','quote_request',
  '92000000-0000-0000-0000-0000000000a1','{}'::jsonb,'cw-teste-desligado'
);

select is(
  (select whatsapp_allowed from public.notification_outbox where dedupe_key='cw-teste-desligado'),
  false,
  'preferência desligada congela whatsapp_allowed = false'
);

select is(
  (select inapp_allowed from public.notification_outbox where dedupe_key='cw-teste-desligado'),
  true,
  'desligar WhatsApp não desliga o inbox do app'
);

select public.enqueue_notification(
  '92000000-0000-0000-0000-000000000002','quote_received','quote_request',
  '92000000-0000-0000-0000-0000000000a2','{}'::jsonb,'cw-teste-ligado'
);

select is(
  (select count(*)::integer from public.reservar_notificacoes_whatsapp(100) r
    where r.id = (select id from public.notification_outbox where dedupe_key='cw-teste-desligado')),
  0,
  'reserva ignora quem optou por não receber WhatsApp'
);

select is(
  (select status from public.notification_outbox where dedupe_key='cw-teste-ligado'),
  'processing',
  'reserva marca a linha como processing'
);

-- ===========================================================================
-- Inbox de webhook
-- ===========================================================================
select is(
  (select novo from public.registrar_evento_chatwoot('entrega-1','message_created','{"id":1}'::jsonb,now())),
  true,
  'primeira entrega registra evento novo'
);

select is(
  (select novo from public.registrar_evento_chatwoot('entrega-1','message_created','{"id":1}'::jsonb,now())),
  false,
  'reentrega do mesmo delivery id não cria evento novo'
);

select is(
  public.concluir_evento_chatwoot(
    (select event_id from public.registrar_evento_chatwoot('entrega-1','message_created','{"id":1}'::jsonb,now())),
    'processed'
  ),
  'processed',
  'evento fecha como processed'
);

select is(
  public.concluir_evento_chatwoot(
    (select id from public.chatwoot_events where chatwoot_event_id='entrega-1'),
    'error', 'retry atrasado'
  ),
  'processed',
  'estado terminal não regride quando um retry chega atrasado'
);

select * from finish();
rollback;
