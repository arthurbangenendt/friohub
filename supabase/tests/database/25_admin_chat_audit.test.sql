begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(3);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('25000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chat-cliente@teste.local','',now(),now()),
('25000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chat-profissional@teste.local','',now(),now()),
('25000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chat-admin@teste.local','',now(),now());

update public.profiles set role='cliente', nome='Cliente Chat' where id='25000000-0000-0000-0000-000000000001';
update public.profiles set role='profissional', nome='Profissional Chat' where id='25000000-0000-0000-0000-000000000002';
update public.profiles set role='admin', nome='Admin Chat' where id='25000000-0000-0000-0000-000000000003';

insert into public.professionals(id,tipo,cidade,estado)
values ('25000000-0000-0000-0000-000000000002','autonomo','São Paulo','SP');

insert into public.conversations(id,cliente_id,professional_id)
values ('25000000-0000-0000-0000-000000000010','25000000-0000-0000-0000-000000000001','25000000-0000-0000-0000-000000000002');

insert into public.messages(id,conversation_id,sender_id,body)
values ('25000000-0000-0000-0000-000000000020','25000000-0000-0000-0000-000000000010','25000000-0000-0000-0000-000000000001','Mensagem para auditoria');

set local role authenticated;
select set_config('request.jwt.claim.sub','25000000-0000-0000-0000-000000000003',true);

select is(
  (select count(*)::integer from public.conversations where id='25000000-0000-0000-0000-000000000010'),
  1,
  'admin lê conversa da qual não participa'
);

select is(
  (select count(*)::integer from public.messages where conversation_id='25000000-0000-0000-0000-000000000010'),
  1,
  'admin lê mensagens da conversa auditada'
);

select throws_ok(
  $$insert into public.messages(conversation_id,sender_id,body) values ('25000000-0000-0000-0000-000000000010','25000000-0000-0000-0000-000000000003','Admin não pode responder')$$,
  '42501',
  'new row violates row-level security policy for table "messages"',
  'admin não envia mensagem em nome próprio na conversa auditada'
);

select * from finish();
rollback;
