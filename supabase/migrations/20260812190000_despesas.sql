-- ============================================================================
-- Despesas do profissional.
--
-- Sem isso a tela financeira só mostra entrada. Quem trabalha em campo tem
-- custo real e recorrente — deslocamento, gás refrigerante, peça, ferramenta —
-- e é a diferença entre faturamento e lucro que diz se o serviço valeu a pena.
--
-- Fica ligada opcionalmente a um job: assim dá para ver o custo de UM serviço
-- (quanto sobrou naquele atendimento) e também o custo do mês inteiro.
-- ============================================================================
create table if not exists public.expenses (
  id              uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals (id) on delete cascade,
  job_id          uuid references public.jobs (id) on delete set null,
  categoria       text not null default 'outros'
                  check (categoria in ('deslocamento', 'material', 'ferramenta',
                                       'gas', 'terceiros', 'imposto', 'outros')),
  descricao       text,
  valor           numeric(10,2) not null check (valor >= 0),
  data            date not null default current_date,
  created_at      timestamptz not null default now()
);

create index if not exists idx_expenses_pro_data on public.expenses (professional_id, data desc);
create index if not exists idx_expenses_job on public.expenses (job_id);

alter table public.expenses enable row level security;

-- Despesa é dado financeiro privado: só o dono enxerga e escreve. Nem o cliente
-- nem outro profissional têm qualquer acesso.
drop policy if exists "expenses_owner_all" on public.expenses;
create policy "expenses_owner_all" on public.expenses for all
  using (auth.uid() = professional_id)
  with check (auth.uid() = professional_id);

comment on table public.expenses is
  'Despesas do profissional. Privado ao dono — nunca exposto a cliente ou a outro parceiro.';
