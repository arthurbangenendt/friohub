-- ============================================================================
-- Portfólio em pares antes/depois.
--
-- "Antes e depois" é o formato que converte em serviço de campo: a foto isolada
-- de um split limpo não diz nada; ao lado da serpentina suja, diz tudo.
--
-- Modelagem: duas linhas de `portfolio_items` compartilham `grupo_id`, uma com
-- momento 'antes' e outra 'depois'. Colunas ficam anuláveis porque a foto
-- avulsa (sem par) continua sendo válida — e porque assim a tabela aceita as
-- linhas antigas sem migração de dados.
-- ============================================================================
alter table public.portfolio_items
  add column if not exists grupo_id uuid,
  add column if not exists momento  text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'portfolio_items_momento_check'
  ) then
    alter table public.portfolio_items
      add constraint portfolio_items_momento_check
      check (momento is null or momento in ('antes', 'depois'));
  end if;
end $$;

-- Dentro de um par não pode haver dois "antes" nem dois "depois".
create unique index if not exists idx_portfolio_grupo_momento
  on public.portfolio_items (grupo_id, momento)
  where grupo_id is not null;

create index if not exists idx_portfolio_pro_grupo
  on public.portfolio_items (professional_id, grupo_id);

comment on column public.portfolio_items.grupo_id is
  'Agrupa as duas fotos de um par antes/depois. Nulo = foto avulsa.';
comment on column public.portfolio_items.momento is
  'antes | depois. Nulo = foto avulsa, sem par.';
