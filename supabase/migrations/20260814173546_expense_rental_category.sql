-- Locação é custo operacional, mas não é compra de ativo. Mantê-la separada
-- evita misturar aluguel de bomba/andaime com ferramentas que viram inventário.
alter table public.expenses
  drop constraint expenses_categoria_check;

alter table public.expenses
  add constraint expenses_categoria_check
  check (categoria in ('deslocamento', 'material', 'ferramenta', 'locacao',
                       'gas', 'terceiros', 'imposto', 'outros'));
