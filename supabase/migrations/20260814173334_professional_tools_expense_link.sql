-- Inventário privado de ferramentas do profissional.
--
-- O lançamento financeiro é criado por trigger na mesma transação do INSERT.
-- Assim, informar um valor nunca deixa uma ferramenta salva sem a despesa (ou
-- uma despesa órfã caso o cadastro da ferramenta falhe).
create table public.professional_tools (
  id              uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals (id) on delete cascade,
  expense_id      uuid unique references public.expenses (id) on delete set null,
  name            text not null check (char_length(btrim(name)) between 2 and 80),
  category        text not null default 'outros'
                  check (category in ('diagnostico', 'instalacao', 'refrigeracao',
                                      'eletrica', 'limpeza', 'seguranca', 'outros')),
  brand           text check (brand is null or char_length(btrim(brand)) between 1 and 60),
  model           text check (model is null or char_length(btrim(model)) between 1 and 60),
  notes           text check (notes is null or char_length(btrim(notes)) between 1 and 240),
  quantity        smallint not null default 1 check (quantity between 1 and 999),
  purchase_price  numeric(10,2) check (purchase_price is null or purchase_price > 0),
  acquired_on     date not null default current_date,
  created_at      timestamptz not null default now()
);

create index idx_professional_tools_owner_created
  on public.professional_tools (professional_id, created_at desc);

alter table public.professional_tools enable row level security;

create policy "professional_tools_owner_read"
  on public.professional_tools for select to authenticated
  using ((select auth.uid()) = professional_id);

create policy "professional_tools_owner_insert"
  on public.professional_tools for insert to authenticated
  with check ((select auth.uid()) = professional_id);

create policy "professional_tools_owner_delete"
  on public.professional_tools for delete to authenticated
  using ((select auth.uid()) = professional_id);

grant select, insert, delete on public.professional_tools to authenticated;
revoke all on public.professional_tools from anon;

create or replace function public.link_professional_tool_expense()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expense_id uuid;
begin
  -- O cliente nunca escolhe o vínculo. Isso impede ligar uma ferramenta a uma
  -- despesa arbitrária por meio da API REST.
  new.expense_id := null;

  if new.purchase_price is null then
    return new;
  end if;

  insert into public.expenses (
    professional_id,
    categoria,
    descricao,
    valor,
    data
  ) values (
    new.professional_id,
    'ferramenta',
    'Compra de ferramenta: ' || btrim(new.name),
    new.purchase_price,
    new.acquired_on
  )
  returning id into v_expense_id;

  new.expense_id := v_expense_id;
  return new;
end;
$$;

revoke all on function public.link_professional_tool_expense() from public, anon, authenticated;

create trigger professional_tools_link_expense
before insert on public.professional_tools
for each row execute function public.link_professional_tool_expense();

comment on table public.professional_tools is
  'Inventário privado do profissional. Preço opcional gera despesa atômica vinculada.';
comment on column public.professional_tools.expense_id is
  'Despesa criada no cadastro. Apagar a ferramenta preserva o histórico financeiro; apagar a despesa apenas remove este vínculo.';
comment on function public.link_professional_tool_expense() is
  'Cria a despesa de ferramenta na mesma transação quando purchase_price foi informado.';
