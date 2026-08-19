begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('b0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pix-tecnico@teste.local','',now(),now()),
('b0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pix-outro@teste.local','',now(),now());

update public.profiles set role='profissional', nome='Técnico PIX'   where id='b0000000-0000-0000-0000-000000000001';
update public.profiles set role='profissional', nome='Outro Técnico' where id='b0000000-0000-0000-0000-000000000002';

insert into public.professionals(id,tipo,cidade,estado)
values
('b0000000-0000-0000-0000-000000000001','autonomo','São Paulo','SP'),
('b0000000-0000-0000-0000-000000000002','autonomo','São Paulo','SP');

-- ===========================================================================
-- Sigilo: chave PIX nunca pode aparecer na allowlist pública de `professionals`
-- ===========================================================================
select has_column('public','professionals','chave_pix','coluna existe');
select ok(
  not has_column_privilege('authenticated','professionals','chave_pix','select'),
  'chave_pix não tem grant de select direto — só via minha_chave_pix()'
);
select ok(
  not has_column_privilege('anon','professionals','chave_pix','select'),
  'anon também não enxerga chave_pix'
);

-- ===========================================================================
-- Cadastro e leitura própria
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000001',true);

select throws_ok(
  $$select public.salvar_chave_pix('11122233344', 'documento')$$,
  'Tipo de chave PIX inválido.',
  'tipo inválido é rejeitado'
);
select throws_ok(
  $$select public.salvar_chave_pix('123', 'cpf')$$,
  'CPF ou CNPJ inválido — use só números.',
  'CPF com dígitos insuficientes é rejeitado'
);
select lives_ok(
  $$select public.salvar_chave_pix('tecnico@exemplo.com', 'email')$$,
  'chave PIX tipo e-mail é aceita'
);
select results_eq(
  $$select chave_pix, chave_pix_tipo from public.minha_chave_pix()$$,
  $$values ('tecnico@exemplo.com'::text, 'email'::text)$$,
  'profissional lê a própria chave de volta'
);

-- Troca livre — não é coleta única como CPF/CNPJ do gateway.
select lives_ok(
  $$select public.salvar_chave_pix('11122233344', 'cpf')$$,
  'profissional pode trocar a chave PIX depois'
);

-- Isolamento: o segundo profissional não vê nem herda a chave do primeiro.
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000002',true);
select results_eq(
  $$select chave_pix, chave_pix_tipo from public.minha_chave_pix()$$,
  $$values (null::text, null::text)$$,
  'outro profissional não vê a chave PIX do primeiro'
);

select * from finish();
rollback;
