-- A base usada para calcular o raio de atendimento pode ser a residência do
-- profissional. Ela não pertence a `professionals` nem a `service_areas`, pois
-- essas tabelas são legíveis publicamente pelo marketplace.
create table public.professional_service_radius (
  professional_id uuid primary key
    references public.professionals(id) on delete cascade,
  latitude numeric(9, 6) not null
    check (latitude between -90 and 90),
  longitude numeric(9, 6) not null
    check (longitude between -180 and 180),
  radius_km smallint not null
    check (radius_km between 1 and 300),
  location_label text not null
    check (char_length(location_label) between 1 and 120),
  accuracy_m integer
    check (accuracy_m is null or accuracy_m between 0 and 100000),
  updated_at timestamptz not null default now()
);

comment on table public.professional_service_radius is
  'Localização privada usada pelo profissional para configurar seu raio de atendimento.';
comment on column public.professional_service_radius.latitude is
  'Coordenada privada; nunca incluir em views ou respostas públicas do marketplace.';
comment on column public.professional_service_radius.longitude is
  'Coordenada privada; nunca incluir em views ou respostas públicas do marketplace.';

create trigger trg_professional_service_radius_touch
  before update on public.professional_service_radius
  for each row execute function public.touch_updated_at();

alter table public.professional_service_radius enable row level security;

create policy "professional_service_radius_owner_only"
  on public.professional_service_radius
  for all
  to authenticated
  using ((select auth.uid()) = professional_id)
  with check ((select auth.uid()) = professional_id);

-- As versões atuais do Supabase não concedem acesso da Data API a novas
-- tabelas automaticamente. O GRANT habilita a tabela para o usuário logado;
-- a RLS continua limitando cada linha ao proprietário.
revoke all on table public.professional_service_radius from anon;
grant select, insert, update, delete
  on table public.professional_service_radius
  to authenticated;
