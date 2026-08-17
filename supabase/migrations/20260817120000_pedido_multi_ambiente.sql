-- ============================================================================
-- Pedido de orçamento com MÚLTIPLOS AMBIENTES
--
-- O problema: quem quer climatizar a casa inteira quer 3 ambientes, não 3
-- pedidos. Até aqui o schema só cabia um: `quote_requests` tem UM `produto_id`,
-- UM `btu_recomendado` e um `detalhes` com `ambiente`/`area_m2` no singular. O
-- cliente com sala + quarto + suíte era obrigado a refazer a triagem inteira
-- três vezes, receber 3× as propostas e aceitar três vezes.
--
-- Custa caro para ele e para o técnico: três aceites viram três jobs, três
-- deslocamentos cobrados. Na prática o profissional faria os três numa visita
-- só — e é justamente esse desconto de pacote que a plataforma não conseguia
-- oferecer.
--
-- A partir daqui: UM pedido carrega N itens (um por ambiente), cada um com sua
-- carga térmica e seu aparelho. O profissional responde com UMA proposta pelo
-- conjunto, e o aceite gera UM job com N itens.
--
-- Compatibilidade: `quote_requests.produto_id`, `btu_recomendado` e as chaves
-- singulares de `detalhes` CONTINUAM sendo gravadas, espelhando o primeiro
-- item. Nenhuma tela ou função existente quebra por causa desta migration; elas
-- migram para os itens no seu próprio ritmo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Itens do pedido — um por ambiente
-- ---------------------------------------------------------------------------
create table if not exists public.quote_request_itens (
  id               uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests (id) on delete cascade,

  -- Ordem de exibição. É o que o cliente vê ("Ambiente 1, 2, 3") e o que dá
  -- estabilidade ao espelho do primeiro item nas colunas legadas.
  ordem            int  not null check (ordem >= 1),

  ambiente         text not null,

  /* Entradas da calculadora de carga térmica, por ambiente. Nulas quando o
     serviço não passa pelo catálogo (manutenção, limpeza): ali o cliente só
     nomeia o cômodo, não recalcula BTU. */
  area_m2          numeric(6,2) check (area_m2 is null or area_m2 > 0),
  num_pessoas      int          check (num_pessoas  is null or num_pessoas  between 0 and 50),
  eletronicos      int          check (eletronicos  is null or eletronicos  between 0 and 50),
  insolacao_alta   boolean not null default false,
  andar_ou_telhado boolean not null default false,
  btu_recomendado  int          check (btu_recomendado is null or btu_recomendado > 0),

  -- Aparelho escolhido para ESTE ambiente. Nulo = cliente já tem o aparelho, ou
  -- serviço sem catálogo. Ambientes diferentes podem usar distribuidoras
  -- diferentes — é o aceite que agrupa isso em ordens de compra.
  produto_id       uuid references public.products (id),

  -- Dois aparelhos idênticos no mesmo ambiente (ex.: salão comercial).
  quantidade       int not null default 1 check (quantidade between 1 and 20),

  created_at       timestamptz not null default now(),

  unique (quote_request_id, ordem)
);

create index if not exists idx_qri_pedido on public.quote_request_itens (quote_request_id, ordem);

comment on table public.quote_request_itens is
  'Um item por ambiente do pedido. O cliente descreve a casa inteira uma vez e recebe uma proposta pelo pacote.';
comment on column public.quote_request_itens.produto_id is
  'Aparelho deste ambiente. Ambientes podem ter aparelhos de distribuidoras diferentes; aceitar_quote agrupa em uma purchase_order por distribuidora.';

-- Mexer num ambiente é mexer no pedido: o `updated_at` do agregado precisa
-- refletir isso, senão a lista do cliente ordena por uma data mentirosa.
create or replace function public.touch_quote_request_from_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.quote_requests
     set updated_at = now()
   where id = coalesce(new.quote_request_id, old.quote_request_id);
  return null;
end;
$$;

create trigger trg_qri_touch_pedido after insert or update or delete on public.quote_request_itens
  for each row execute function public.touch_quote_request_from_item();

-- ---------------------------------------------------------------------------
-- 2. Limite de ambientes por pedido
--
--    Sem teto, um pedido com 200 ambientes vira 200 linhas para o profissional
--    ler no celular e nenhuma proposta sai. Vinte cobre casa, escritório e
--    andar de prédio com folga.
-- ---------------------------------------------------------------------------
create or replace function public.checar_limite_itens_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total int;
begin
  select count(*) into v_total
    from public.quote_request_itens
   where quote_request_id = new.quote_request_id;

  if v_total > 20 then
    raise exception 'Um pedido de orçamento aceita no máximo 20 ambientes.';
  end if;

  return null;
end;
$$;

create constraint trigger trg_qri_limite
  after insert on public.quote_request_itens
  deferrable initially deferred
  for each row execute function public.checar_limite_itens_pedido();

-- ---------------------------------------------------------------------------
-- 3. RLS — os itens seguem exatamente a visibilidade do pedido
--
--    Mesma regra das fotos: quem enxerga o pedido enxerga os ambientes. Só o
--    cliente dono escreve, e apenas enquanto o pedido está aberto — depois de
--    fechado, mudar um ambiente reescreveria o escopo de uma proposta que já
--    foi precificada.
-- ---------------------------------------------------------------------------
alter table public.quote_request_itens enable row level security;

drop policy if exists "qri_read" on public.quote_request_itens;
create policy "qri_read" on public.quote_request_itens for select
  using (
    exists (
      select 1 from public.quote_requests q
       where q.id = quote_request_itens.quote_request_id
         and (
           q.cliente_id = (select auth.uid())
           or exists (
             select 1 from public.quote_request_targets t
              where t.quote_request_id = q.id
                and t.professional_id = (select auth.uid())
           )
         )
    )
    or public.eh_admin()
  );

drop policy if exists "qri_cliente_write" on public.quote_request_itens;
create policy "qri_cliente_write" on public.quote_request_itens for all
  using (
    exists (
      select 1 from public.quote_requests q
       where q.id = quote_request_itens.quote_request_id
         and q.cliente_id = (select auth.uid())
         and q.status = 'aberto'
    )
  )
  with check (
    exists (
      select 1 from public.quote_requests q
       where q.id = quote_request_itens.quote_request_id
         and q.cliente_id = (select auth.uid())
         and q.status = 'aberto'
    )
  );

/* A policy só filtra linhas DEPOIS que o papel tem privilégio SQL. Sem este
   grant, a tabela fica invisível para a Data API mesmo com a RLS correta.
   O cliente edita os ambientes do próprio pedido enquanto ele está aberto. */
grant select, insert, update, delete on public.quote_request_itens to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Backfill — todo pedido existente vira um pedido de um ambiente
--
--    Depois disto, TODA leitura pode assumir que existe pelo menos um item, sem
--    precisar de um caminho especial para os pedidos antigos.
-- ---------------------------------------------------------------------------
insert into public.quote_request_itens (
  quote_request_id, ordem, ambiente, area_m2, num_pessoas, eletronicos,
  insolacao_alta, andar_ou_telhado, btu_recomendado, produto_id, quantidade
)
select
  q.id,
  1,
  coalesce(nullif(btrim(q.detalhes->>'ambiente'), ''), 'Ambiente'),
  nullif(q.detalhes->>'area_m2', '')::numeric,
  nullif(q.detalhes->>'num_pessoas', '')::int,
  nullif(q.detalhes->>'eletronicos', '')::int,
  coalesce(nullif(q.detalhes->>'insolacao_alta', '')::boolean, false),
  coalesce(nullif(q.detalhes->>'andar_ou_telhado', '')::boolean, false),
  q.btu_recomendado,
  q.produto_id,
  greatest(1, least(20, coalesce(q.quantidade, 1)))
  from public.quote_requests q
 where not exists (
   select 1 from public.quote_request_itens i where i.quote_request_id = q.id
 );
