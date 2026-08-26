begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);

select has_function('public', 'alterar_papel_usuario', array['uuid','text','text'], 'RPC de troca de papel existe');
select ok(
  not exists (
    select 1 from pg_proc
     where proname = 'alterar_papel_usuario'
       and pg_get_userbyid(proowner) = 'anon'
  ),
  'função não pertence a anon'
);

-- ===========================================================================
-- Fixture: admin, cliente comum, profissional (nunca pode virar cliente por
-- aqui) e um segundo cliente sem vínculo, pra testar acesso negado.
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) values
('c1000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-papel@teste.local','',now(),now()),
('c1000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cliente-papel@teste.local','',now(),now()),
('c1000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pro-papel@teste.local','',now(),now()),
('c1000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','outro-cliente-papel@teste.local','',now(),now());

update public.profiles set role='admin', nome='Admin Papel' where id='c1000000-0000-0000-0000-000000000001';
update public.profiles set role='cliente', nome='Cliente Papel' where id='c1000000-0000-0000-0000-000000000002';
update public.profiles set role='profissional', nome='Profissional Papel' where id='c1000000-0000-0000-0000-000000000003';
update public.profiles set role='cliente', nome='Outro Cliente Papel' where id='c1000000-0000-0000-0000-000000000004';

insert into public.professionals (id, tipo, cidade, estado, verification_status) values
('c1000000-0000-0000-0000-000000000003','autonomo','São Paulo','SP','verificado');

-- ---------------------------------------------------------------------------
-- Cliente comum não executa a função.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-0000-0000-000000000002',true);
select throws_ok(
  $$select public.alterar_papel_usuario('c1000000-0000-0000-0000-000000000004', 'admin', 'tentativa indevida')$$,
  'Acesso restrito a administradores.',
  'cliente não promove outro cliente a admin'
);
reset role;

-- ---------------------------------------------------------------------------
-- Admin promove cliente a admin — atravessa protege_role_profile por dentro
-- da função SECURITY DEFINER (current_user deixa de ser 'authenticated').
-- É exatamente o comportamento que este teste existe para confirmar.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-0000-0000-000000000001',true);
select lives_ok(
  $$select public.alterar_papel_usuario('c1000000-0000-0000-0000-000000000002', 'admin', 'suporte precisa de mais um admin')$$,
  'admin promove cliente a admin'
);
reset role;

select is(
  (select role from public.profiles where id='c1000000-0000-0000-0000-000000000002'),
  'admin',
  'role foi atualizado de verdade'
);

select is(
  (select action from public.admin_audit_log
    where entity_type='profile' and entity_id='c1000000-0000-0000-0000-000000000002'
    order by created_at desc limit 1),
  'role_changed',
  'promoção ficou registrada no log de auditoria'
);

-- ---------------------------------------------------------------------------
-- Reverter: admin revoga o admin recém-criado.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-0000-0000-000000000001',true);
select lives_ok(
  $$select public.alterar_papel_usuario('c1000000-0000-0000-0000-000000000002', 'cliente', 'era temporário, revertendo')$$,
  'admin revoga o admin recém-criado'
);
reset role;

select is(
  (select role from public.profiles where id='c1000000-0000-0000-0000-000000000002'),
  'cliente',
  'role voltou a cliente'
);

-- ---------------------------------------------------------------------------
-- Guarda-corpos: nunca profissional/distribuidora, nunca autopromoção,
-- sempre justificativa.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-0000-0000-000000000001',true);

select throws_ok(
  $$select public.alterar_papel_usuario('c1000000-0000-0000-0000-000000000003', 'cliente', 'tentando rebaixar profissional')$$,
  'Esta função não altera profissional nem distribuidora — eles têm ciclo de vida próprio.',
  'não mexe em profissional'
);

select throws_ok(
  $$select public.alterar_papel_usuario('c1000000-0000-0000-0000-000000000001', 'cliente', 'tentando me autorrevogar')$$,
  'Você não pode alterar o próprio papel por aqui.',
  'admin não se autorrevoga'
);

select throws_ok(
  $$select public.alterar_papel_usuario('c1000000-0000-0000-0000-000000000004', 'admin', 'sem')$$,
  'Informe uma justificativa entre 5 e 500 caracteres.',
  'justificativa curta é recusada'
);

select throws_ok(
  $$select public.alterar_papel_usuario('c1000000-0000-0000-0000-000000000004', 'profissional', 'tentando virar profissional por aqui')$$,
  'Esta função só alterna entre cliente e admin.',
  'não aceita papel fora de cliente/admin'
);

reset role;

select is(
  (select role from public.profiles where id='c1000000-0000-0000-0000-000000000003'),
  'profissional',
  'profissional segue intacto após as tentativas recusadas'
);

select * from finish();
rollback;
