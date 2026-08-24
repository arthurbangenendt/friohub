-- ============================================================================
-- Formulário de interesse de distribuidora — substitui o cadastro direto
-- ============================================================================
--
-- A landing /distribuidoras tinha dois botões indo direto pra
-- /signup?role=distribuidora, mesmo o time tendo decidido manter o cadastro
-- sob controle do admin (o backend já aceita self-service desde
-- 20260812260000, mas isso não vira porta pública). O visitante deixa
-- contato aqui; o admin decide quando (e se) manda o link de cadastro.
--
-- Insert público (é formulário de contato, sem login) — mesmo nível de
-- sensibilidade de qualquer form de "fale com a gente". Leitura só admin.

create table public.distributor_interest (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null check (char_length(btrim(nome)) between 2 and 120),
  empresa      text not null check (char_length(btrim(empresa)) between 2 and 160),
  telefone     text,
  email        text,
  cidade       text,
  mensagem     text,
  created_at   timestamptz not null default now(),
  contatado_em timestamptz,
  check (telefone is not null or email is not null)
);

comment on table public.distributor_interest is
  'Lead de distribuidora interessada — captado na landing pública, sem criar conta. Admin decide quando enviar o link de cadastro.';

alter table public.distributor_interest enable row level security;

create policy "distributor_interest_public_insert" on public.distributor_interest
  for insert to anon, authenticated
  with check (true);

create policy "distributor_interest_admin_read" on public.distributor_interest
  for select to authenticated
  using ((select public.eh_admin()));

create policy "distributor_interest_admin_update" on public.distributor_interest
  for update to authenticated
  using ((select public.eh_admin()))
  with check ((select public.eh_admin()));

revoke all on public.distributor_interest from public;
grant insert on public.distributor_interest to anon, authenticated;
grant select, update on public.distributor_interest to authenticated;

create index idx_distributor_interest_created on public.distributor_interest (created_at desc);
