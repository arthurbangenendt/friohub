-- ============================================================================
-- Estoque com quantidade (auto-relatado pela distribuidora)
--
-- `products.estoque_disponivel` era só um booleano: dois pedidos concorrentes
-- para o mesmo item passavam pela mesma checagem e ambos "passavam". FrioHub
-- não guarda estoque físico — quem informa quantas unidades tem é a própria
-- distribuidora — então isto é só o número que ela digita, não um inventário
-- gerenciado pela plataforma.
--
-- `estoque_quantidade` é nullable de propósito: produto sem quantidade
-- informada continua no modo booleano legado (`estoque_disponivel` editado
-- direto, sem baixa automática) — nenhuma distribuidora existente é forçada a
-- migrar. Quando a distribuidora preenche a quantidade, ela vira a fonte de
-- verdade e `estoque_disponivel` passa a ser derivado dela.
-- ============================================================================

alter table public.products
  add column estoque_quantidade integer,
  add constraint products_estoque_quantidade_check
    check (estoque_quantidade is null or estoque_quantidade >= 0);

comment on column public.products.estoque_quantidade is
  'Quantidade em estoque informada pela distribuidora (auto-relatada, não é inventário gerenciado pela FrioHub). NULL = modo booleano legado, estoque_disponivel editado direto.';

-- ---------------------------------------------------------------------------
-- `protege_produto` passa a derivar o booleano da quantidade quando ela
-- existe — mesmo trigger único de 20260813150445_hardening_integridade_p0.sql,
-- só ganha mais um passo antes do `return new`.
-- ---------------------------------------------------------------------------
create or replace function public.protege_produto()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_markup numeric;
  v_admin  boolean := public.eh_admin();
  v_uid    uuid := (select auth.uid());
begin
  select pc.markup_produto_pct
    into v_markup
    from public.platform_config pc
   where pc.id;

  v_markup := coalesce(v_markup, 0.25);

  if current_user in ('authenticated', 'anon') and not v_admin then
    if v_uid is null or not exists (
      select 1 from public.profiles p
       where p.id = v_uid and p.role = 'distribuidora'
    ) then
      raise exception 'Apenas distribuidoras podem manter produtos.';
    end if;

    if tg_op = 'INSERT' then
      new.distributor_id := v_uid;
      new.preco_manual   := false;
      new.preco_venda    := round(new.custo * (1 + v_markup), 2);
    else
      new.distributor_id := old.distributor_id;
      if old.preco_manual then
        new.preco_manual := true;
        new.preco_venda  := old.preco_venda;
      else
        new.preco_manual := false;
        new.preco_venda  := round(new.custo * (1 + v_markup), 2);
      end if;
    end if;
  elsif new.preco_manual then
    if new.preco_venda <= 0 then
      raise exception 'Preço manual precisa ser maior que zero.';
    end if;
  else
    new.preco_venda := round(new.custo * (1 + v_markup), 2);
  end if;

  if new.custo <= 0 then
    raise exception 'Custo do produto precisa ser maior que zero.';
  end if;
  if new.btu <= 0 then
    raise exception 'Capacidade do produto precisa ser maior que zero.';
  end if;

  -- Quantidade informada é a fonte de verdade do booleano — inclusive quando
  -- quem grava é uma função SECURITY DEFINER dando baixa em estoque (ex.:
  -- aceitar_quote), não só quando é a distribuidora editando na tela.
  if new.estoque_quantidade is not null then
    new.estoque_disponivel := new.estoque_quantidade > 0;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- `meus_produtos` passa a expor a quantidade pra distribuidora ver/editar.
-- ---------------------------------------------------------------------------
-- `create or replace view` só aceita coluna nova no fim da lista — não pode
-- inserir no meio da posição das colunas existentes.
create or replace view public.meus_produtos with (security_invoker = off) as
  select p.id, p.marca, p.modelo, p.btu, p.categoria, p.preco_venda, p.custo,
         p.preco_manual, p.image_url, p.ativo, p.estoque_disponivel,
         p.distributor_id, p.created_at, p.estoque_quantidade
    from public.products p
   where p.distributor_id = auth.uid();
