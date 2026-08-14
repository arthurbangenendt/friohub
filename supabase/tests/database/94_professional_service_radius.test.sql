begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.professional_service_radius'::regclass),
  'localização do profissional tem RLS habilitada'
);

select ok(
  not has_table_privilege('anon', 'public.professional_service_radius', 'SELECT'),
  'anônimo não alcança as coordenadas privadas'
);

select ok(
  has_table_privilege('authenticated', 'public.professional_service_radius', 'SELECT')
  and has_table_privilege('authenticated', 'public.professional_service_radius', 'INSERT')
  and has_table_privilege('authenticated', 'public.professional_service_radius', 'UPDATE')
  and has_table_privilege('authenticated', 'public.professional_service_radius', 'DELETE'),
  'profissional autenticado alcança a tabela sob RLS'
);

select ok(
  (select count(*) >= 3
     from pg_constraint
    where conrelid = 'public.professional_service_radius'::regclass
      and contype = 'c'),
  'coordenadas, raio, rótulo e precisão possuem limites no banco'
);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('94000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','radius-pro1@teste.local','',now(),now()),
('94000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','radius-pro2@teste.local','',now(),now());

update public.profiles set role='profissional' where id in (
  '94000000-0000-0000-0000-000000000001',
  '94000000-0000-0000-0000-000000000002'
);
insert into public.professionals(id,tipo,cidade,estado) values
('94000000-0000-0000-0000-000000000001','autonomo','São Paulo','SP'),
('94000000-0000-0000-0000-000000000002','autonomo','Campinas','SP');

set local role authenticated;
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000001',true);

insert into public.professional_service_radius(
  professional_id, latitude, longitude, radius_km, location_label, accuracy_m
) values (
  '94000000-0000-0000-0000-000000000001', -23.550520, -46.633308, 25, 'São Paulo, SP', 80
);

select is(
  (select count(*)::integer from public.professional_service_radius),
  1,
  'proprietário salva e lê a própria área'
);

select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000002',true);
select is(
  (select count(*)::integer from public.professional_service_radius),
  0,
  'outro profissional não enxerga as coordenadas'
);

update public.professional_service_radius
   set radius_km = 100
 where professional_id = '94000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000001',true);
select is(
  (select radius_km::integer from public.professional_service_radius),
  25,
  'outro profissional não altera o raio'
);

select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000002',true);
select throws_ok(
  $$insert into public.professional_service_radius(professional_id,latitude,longitude,radius_km,location_label)
    values ('94000000-0000-0000-0000-000000000001',-22.9,-47.0,50,'Base alheia')$$,
  '42501',
  'new row violates row-level security policy for table "professional_service_radius"',
  'outro profissional não grava coordenadas em nome do proprietário'
);

select * from finish();
rollback;
