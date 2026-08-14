begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(11);

select has_view('public', 'diretorio_profissionais', 'vitrine pública existe');

/* `security_invoker` é o ponto central desta view: sem ele, a view rodaria com
   os privilégios de quem a criou e passaria por cima da RLS de `professionals`,
   `profiles` e `professional_skills`. */
select ok(
  (select reloptions::text from pg_class where relname = 'diretorio_profissionais')
    ilike '%security_invoker=%true%',
  'view roda com os privilégios de quem consulta'
);

select ok(
  has_table_privilege('anon', 'public.diretorio_profissionais', 'SELECT'),
  'visitante anônimo pode navegar na vitrine'
);

/* Nada além do que o grant de coluna de 20260814114010 já permitia ao anônimo.
   CNPJ e estado da assinatura continuam fora — a view sequer os referencia. */
select hasnt_column('public', 'diretorio_profissionais', 'cnpj', 'vitrine não expõe CNPJ');
select hasnt_column('public', 'diretorio_profissionais', 'subscription_status', 'vitrine não expõe estado da assinatura');
select hasnt_column('public', 'diretorio_profissionais', 'subscription_plan_id', 'vitrine não expõe plano contratado');

/* A busca transacional continua fechada: a vitrine não pode virar um atalho
   para o ranking quality_v1 nem para os sinais operacionais. */
select ok(
  not has_function_privilege(
    'anon',
    'public.buscar_profissionais_marketplace(text,text,text,text,boolean,integer,integer,double precision,double precision)',
    'EXECUTE'
  ),
  'busca por CEP com ranking segue exclusiva de usuário autenticado'
);

-- ---------------------------------------------------------------------------
-- Agregação
-- ---------------------------------------------------------------------------
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('99000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','vitrine-pro@teste.local','',now(),now());
update public.profiles set role='profissional', nome='Pro Vitrine' where id='99000000-0000-0000-0000-000000000001';
insert into public.professionals(id,tipo,bio,cidade,estado)
values ('99000000-0000-0000-0000-000000000001','autonomo','Instalação e manutenção','São Paulo','SP');

/* Duas especialidades com volumes bem diferentes. A média ponderada tem de
   ficar perto da nota que tem mais avaliações — se fosse `max(rating_avg)`, o
   resultado seria 5,00 por causa das duas avaliações da limpeza. */
insert into public.professional_skills(professional_id,specialty,rating_avg,rating_count,jobs_completed) values
('99000000-0000-0000-0000-000000000001','instalacao',4.50,40,40),
('99000000-0000-0000-0000-000000000001','limpeza',5.00,2,2);

select is(
  (select nota from public.diretorio_profissionais where id='99000000-0000-0000-0000-000000000001'),
  4.52::numeric,
  'nota é média ponderada pelo número de avaliações, não a melhor especialidade'
);
select is(
  (select avaliacoes from public.diretorio_profissionais where id='99000000-0000-0000-0000-000000000001'),
  42,
  'total de avaliações soma todas as especialidades'
);
select is(
  (select servicos from public.diretorio_profissionais where id='99000000-0000-0000-0000-000000000001'),
  42,
  'total de serviços soma todas as especialidades'
);
select is(
  (select array_length(especialidades, 1) from public.diretorio_profissionais where id='99000000-0000-0000-0000-000000000001'),
  2,
  'especialidades ficam disponíveis para o filtro da vitrine'
);

select * from finish();
rollback;
