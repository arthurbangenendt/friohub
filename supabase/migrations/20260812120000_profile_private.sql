-- ============================================================================
-- Dados pessoais sensíveis saem de `profiles`.
--
-- `profiles` é lida de forma ampla e isso é proposital:
--   · "profiles_read_auth"          → qualquer autenticado faz SELECT
--   · "profiles_read_professionals" → visitante anônimo faz SELECT dos pros
--
-- As duas são necessárias: o app exibe o NOME do cliente para o profissional
-- (painel, página do serviço) e o NOME do profissional para visitantes.
--
-- O problema é que a policy vale para a LINHA INTEIRA — não há RLS por coluna.
-- Com isso o `telefone` de todo profissional estava legível por qualquer
-- visitante não-logado, e o de todo cliente por qualquer conta criada de graça.
--
-- Aqui o dado sensível muda de tabela. `profiles` fica só com o que é de fato
-- exibido em público (nome, avatar, role); telefone e CPF/CNPJ passam a viver
-- em `profile_private`, com RLS restrita ao dono (+ leitura para admin).
-- ============================================================================

create table if not exists public.profile_private (
  id         uuid primary key references public.profiles (id) on delete cascade,
  telefone   text,
  cpf_cnpj   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profile_private is
  'Dados pessoais sensíveis. Nunca exposto a anônimo — RLS: dono + leitura admin.';

alter table public.profile_private enable row level security;

-- O dono lê e escreve os próprios dados.
drop policy if exists "profile_private_self_all" on public.profile_private;
create policy "profile_private_self_all" on public.profile_private
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- Admin lê (suporte e, adiante, KYC). Não escreve: alteração é sempre do dono.
drop policy if exists "profile_private_admin_read" on public.profile_private;
create policy "profile_private_admin_read" on public.profile_private
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create trigger trg_profile_private_touch before update on public.profile_private
  for each row execute function public.touch_updated_at();

-- Backfill antes de derrubar a coluna: nenhum telefone existente se perde.
insert into public.profile_private (id, telefone)
select id, telefone from public.profiles where telefone is not null
on conflict (id) do update set telefone = excluded.telefone;

alter table public.profiles drop column if exists telefone;
