begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);

select has_function('public', 'obter_documento_verificacao', array['uuid'], 'RPC de documento de verificação existe');

-- ===========================================================================
-- Fixture: dois profissionais em análise — um com documento enviado, outro
-- sem (caso comum: cadastro recém-criado, ainda não chegou a hora de anexar).
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) values
('d0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pro-doc-com@teste.local','',now(),now()),
('d0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pro-doc-sem@teste.local','',now(),now()),
('d0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-doc@teste.local','',now(),now());

update public.profiles set role='profissional', nome='Pro Com Documento' where id='d0000000-0000-0000-0000-000000000001';
update public.profiles set role='profissional', nome='Pro Sem Documento' where id='d0000000-0000-0000-0000-000000000002';
update public.profiles set role='admin', nome='Admin Doc' where id='d0000000-0000-0000-0000-000000000003';

insert into public.professionals (id, tipo, cidade, estado, verification_status, documento_tipo, documento_storage_path) values
('d0000000-0000-0000-0000-000000000001','autonomo','São Paulo','SP','em_analise','rg','d0000000-0000-0000-0000-000000000001/doc.pdf'),
('d0000000-0000-0000-0000-000000000002','autonomo','São Paulo','SP','em_analise',null,null);

-- ---------------------------------------------------------------------------
-- Não-admin (nem o próprio profissional) não lê o caminho do documento.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000001',true);
select throws_ok(
  $$select public.obter_documento_verificacao('d0000000-0000-0000-0000-000000000001'::uuid)$$,
  'Acesso restrito a administradores.',
  'nem o próprio profissional lê o caminho do documento por essa RPC'
);
reset role;

-- ---------------------------------------------------------------------------
-- Admin lê o caminho de quem enviou documento.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000003',true);
select is(
  public.obter_documento_verificacao('d0000000-0000-0000-0000-000000000001'::uuid),
  'd0000000-0000-0000-0000-000000000001/doc.pdf',
  'admin lê o caminho do documento enviado'
);

-- ---------------------------------------------------------------------------
-- Profissional sem documento enviado devolve null, não erro — cadastro sem
-- anexo ainda é um estado válido, não uma falha.
-- ---------------------------------------------------------------------------
select is(
  public.obter_documento_verificacao('d0000000-0000-0000-0000-000000000002'::uuid),
  null,
  'profissional sem documento enviado devolve null'
);

-- ---------------------------------------------------------------------------
-- Profissional inexistente também devolve null, não quebra a tela.
-- ---------------------------------------------------------------------------
select is(
  public.obter_documento_verificacao('00000000-0000-0000-0000-000000000000'::uuid),
  null,
  'profissional inexistente devolve null'
);
reset role;

select * from finish();
rollback;
