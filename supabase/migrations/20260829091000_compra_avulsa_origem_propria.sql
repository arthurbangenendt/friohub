-- ============================================================================
-- Compra avulsa ganha origem própria em vez de emprestar 'aceite_quote'
--
-- `criar_compra_avulsa` (20260828140000) grava a order com origem='aceite_
-- quote' (default da coluna) só porque `preparar_cobranca_servico` antigo
-- achava a order por origem. Isso já não é mais verdade desde
-- 20260828110000_fix_cobranca_orcamento_final.sql, que passou a receber
-- order_id explícito. O empréstimo ficou como pegadinha: qualquer código
-- futuro que assuma origem='aceite_quote' => existe profissional/proposta
-- aceita se engana numa compra avulsa (profissional_id sempre nulo).
-- ============================================================================

set lock_timeout = '5s';
set statement_timeout = '30s';

alter table public.orders drop constraint orders_origem_check;
alter table public.orders add constraint orders_origem_check
  check (origem in ('aceite_quote', 'orcamento_final', 'compra_avulsa'));

create or replace function public.criar_compra_avulsa(
  p_itens jsonb,
  p_cep text,
  p_cidade text,
  p_endereco text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := (select auth.uid());
  v_papel        text;
  v_job_id       uuid;
  v_order_id     uuid;
  v_venda        numeric(10,2) := 0;
  v_custo        numeric(10,2) := 0;
  v_indisponivel text;
  v_primeiro_produto_id uuid;
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;

  select role into v_papel from public.profiles where id = v_uid;
  if v_papel not in ('cliente', 'profissional') then
    raise exception 'Apenas cliente ou profissional pode comprar equipamento avulso.';
  end if;

  if nullif(btrim(coalesce(p_cep, '')), '') is null then
    raise exception 'Informe o CEP de entrega.';
  end if;
  if nullif(btrim(coalesce(p_cidade, '')), '') is null then
    raise exception 'Informe a cidade de entrega.';
  end if;
  if nullif(btrim(coalesce(p_endereco, '')), '') is null then
    raise exception 'Informe o endereço completo de entrega.';
  end if;
  if char_length(p_endereco) > 500 then
    raise exception 'O endereço informado é muito longo.';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Informe ao menos um item.';
  end if;
  if jsonb_array_length(p_itens) > 20 then
    raise exception 'No máximo 20 itens por compra.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_itens) as item
     where nullif(item->>'produtoId', '') is null
  ) then
    raise exception 'Item inválido.';
  end if;

  if (select count(*) from jsonb_array_elements(p_itens) as item)
     <> (select count(distinct item->>'produtoId') from jsonb_array_elements(p_itens) as item)
  then
    raise exception 'Produto repetido — some as quantidades num item só.';
  end if;

  perform 1
     from jsonb_array_elements(p_itens) as item
     join public.products p on p.id = (item->>'produtoId')::uuid
     join public.distributors d on d.id = p.distributor_id
    for update of p, d;

  select string_agg(distinct coalesce(p.marca || ' ' || p.modelo, 'produto removido do catálogo'), ', ')
    into v_indisponivel
    from jsonb_array_elements(p_itens) as item
    left join public.products p on p.id = (item->>'produtoId')::uuid
    left join public.distributors d on d.id = p.distributor_id
   where p.id is null
      or not (p.ativo and p.estoque_disponivel and d.ativo and d.verification_status = 'verificado')
      or (p.estoque_quantidade is not null
          and p.estoque_quantidade < greatest(1, least(20, coalesce((item->>'quantidade')::int, 1))));

  if v_indisponivel is not null then
    raise exception 'Estes itens não estão mais disponíveis: %.', v_indisponivel;
  end if;

  select (item->>'produtoId')::uuid
    into v_primeiro_produto_id
    from jsonb_array_elements(p_itens) with ordinality as t(item, ord)
   order by ord
   limit 1;

  insert into public.jobs (cliente_id, job_type, has_equipment, cep, cidade, endereco, status, produto_id)
  values (v_uid, 'compra_equipamento', true, btrim(p_cep), btrim(p_cidade), btrim(p_endereco), 'aberto', v_primeiro_produto_id)
  returning id into v_job_id;

  with itens as (
    select
      (item->>'produtoId')::uuid as produto_id,
      greatest(1, least(20, coalesce((item->>'quantidade')::int, 1))) as quantidade,
      ord as ordem
    from jsonb_array_elements(p_itens) with ordinality as t(item, ord)
  )
  insert into public.job_itens (
    job_id, ordem, ambiente, quantidade, produto_id,
    preco_venda_snapshot, custo_snapshot, distributor_id
  )
  select v_job_id, i.ordem, 'Equipamento', i.quantidade, p.id,
         p.preco_venda * i.quantidade, p.custo * i.quantidade, p.distributor_id
    from itens i
    join public.products p on p.id = i.produto_id;

  with itens as (
    select
      (item->>'produtoId')::uuid as produto_id,
      greatest(1, least(20, coalesce((item->>'quantidade')::int, 1))) as quantidade
    from jsonb_array_elements(p_itens) as item
  )
  update public.products p
     set estoque_quantidade = p.estoque_quantidade - i.quantidade
    from itens i
   where p.id = i.produto_id
     and p.estoque_quantidade is not null;

  select coalesce(sum(preco_venda_snapshot), 0), coalesce(sum(custo_snapshot), 0)
    into v_venda, v_custo
    from public.job_itens
   where job_id = v_job_id;

  -- origem própria: compra avulsa nunca teve proposta aceita nem
  -- orçamento final — usar qualquer um dos outros dois valores enganaria
  -- código futuro que leia origem como sinal de "existe profissional".
  insert into public.orders (
    job_id, preco_produto, preco_servico, comissao_servico, margem_produto, total, payment_status, origem
  ) values (
    v_job_id, v_venda, 0, 0, v_venda - v_custo, v_venda, 'pendente', 'compra_avulsa'
  )
  returning id into v_order_id;

  insert into public.purchase_orders (order_id, distributor_id, custo_snapshot, prazo_previsto)
  select v_order_id, ji.distributor_id, sum(ji.custo_snapshot),
         current_date + coalesce(max(d.prazo_entrega_dias), 5)
    from public.job_itens ji
    join public.distributors d on d.id = ji.distributor_id
   where ji.job_id = v_job_id
   group by ji.distributor_id;

  return v_job_id;
end;
$$;

revoke all on function public.criar_compra_avulsa(jsonb, text, text, text) from public, anon;
grant execute on function public.criar_compra_avulsa(jsonb, text, text, text) to authenticated;
