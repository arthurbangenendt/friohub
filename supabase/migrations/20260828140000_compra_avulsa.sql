-- ============================================================================
-- Compra avulsa de equipamento/peça — sem abrir um pedido de orçamento
--
-- Hoje o único jeito de comprar equipamento pela plataforma é dentro do ciclo
-- orçamento → job → aceite (`aceitar_quote`). Isso obriga até uma reposição
-- simples de peça (o técnico repondo uma peça de reposição pra um serviço que
-- já está fazendo, ou o cliente comprando um aparelho sozinho, sem instalação
-- atrelada) a passar por um pedido de orçamento inteiro — na prática, empurra
-- esse tipo de compra pra fora do sistema.
--
-- Decisão de arquitetura (registrada com o dono): reaproveitar `jobs`/`orders`
-- em vez de criar tabelas paralelas — herda de graça todo o financeiro
-- (ledger, payment_allocations), o repasse à distribuidora (purchase_orders,
-- tela /painel/distribuidora/pedidos), a tela de acompanhamento do cliente
-- (/servico/[id]/aparelho) e a cobrança Asaas (preparar_cobranca_servico,
-- fixado em 20260828110000 pra aceitar order_id explícito).
--
-- Modelo: `jobs.job_type = 'compra_equipamento'`, `profissional_id` nulo,
-- `preco_servico = 0`. Sem mão de obra nem execução, a máquina de status fica
-- só `aberto → concluido` (ambos já existem no CHECK de `jobs.status` — não
-- precisa alterar). `jobs.cliente_id` é reaproveitado para "quem comprou",
-- mesmo quando é um profissional comprando uma peça — a página do serviço já
-- decide `isCliente = job.cliente_id === user.id`, então a tela funciona sem
-- nenhuma mudança de RLS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Novo job_type
-- ---------------------------------------------------------------------------
alter table public.jobs drop constraint if exists jobs_job_type_check;
alter table public.jobs add constraint jobs_job_type_check
  check (job_type in ('instalacao_com_equipamento', 'manutencao', 'remanejamento',
                      'limpeza', 'conserto', 'troca_equipamento', 'outros',
                      'compra_equipamento'));

-- ---------------------------------------------------------------------------
-- 2. Cria a compra: valida catálogo, trava e decrementa estoque, gera
--    job + job_itens + order + purchase_orders — mesmo padrão de
--    `aceitar_quote`, sem a parte de proposta/profissional.
-- ---------------------------------------------------------------------------
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

  -- Trava as linhas de produto envolvidas ANTES de validar/decrementar —
  -- mesmo motivo de `aceitar_quote`: fecha a janela de corrida entre duas
  -- compras concorrentes do mesmo SKU com quantidade controlada.
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

  -- Coluna singular `jobs.produto_id` espelha o PRIMEIRO item — mesmo padrão
  -- de `aceitar_quote` para pedidos multi-ambiente (ver comentário
  -- "Colunas singulares de jobs seguem espelhando o primeiro ambiente" em
  -- 20260817122000_aceitar_quote_multi_ambiente.sql). Sem isso, a tela
  -- /servico/[id] mostra o card "Detalhes" vazio numa compra de item único —
  -- job.ambiente/produto_id não existem em compra_equipamento, só job_itens.
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

  -- origem = 'aceite_quote' (default da coluna): mesmo rótulo usado por
  -- `aceitar_quote`, reaproveitado de propósito — quem cobra
  -- (preparar_cobranca_servico) já sabe achar "a order do job" por
  -- origem='aceite_quote' sem precisar de um terceiro valor de origem.
  insert into public.orders (
    job_id, preco_produto, preco_servico, comissao_servico, margem_produto, total, payment_status
  ) values (
    v_job_id, v_venda, 0, 0, v_venda - v_custo, v_venda, 'pendente'
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

comment on function public.criar_compra_avulsa is
  'Compra de equipamento/peça sem pedido de orçamento — job_type compra_equipamento, sem profissional nem mão de obra. Mesmo padrão de validação/estoque/purchase_orders de aceitar_quote.';

-- ---------------------------------------------------------------------------
-- 3. Conclusão automática: quando TODAS as entregas (purchase_orders) de uma
--    compra avulsa chegam a 'entregue', o job vira 'concluido' sozinho — não
--    há profissional pra clicar em "concluir". `protege_job_transicao` não
--    bloqueia esta escrita porque ela roda dentro do trigger de uma função
--    SECURITY DEFINER (avancar_purchase_order): current_user já não é
--    'authenticated'/'anon' nesse contexto (mesmo raciocínio documentado em
--    20260817130000_orcamento_final_pos_visita.sql).
-- ---------------------------------------------------------------------------
create or replace function public.conclui_compra_avulsa_entregue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs%rowtype;
begin
  if new.status is distinct from 'entregue' or old.status is not distinct from 'entregue' then
    return new;
  end if;

  select j.* into v_job
    from public.orders o
    join public.jobs j on j.id = o.job_id
   where o.id = new.order_id;

  if v_job.job_type is distinct from 'compra_equipamento' or v_job.status = 'concluido' then
    return new;
  end if;

  if not exists (
    select 1 from public.purchase_orders po
     where po.order_id = new.order_id and po.status is distinct from 'entregue'
  ) then
    update public.jobs set status = 'concluido' where id = v_job.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_conclui_compra_avulsa on public.purchase_orders;
create trigger trg_conclui_compra_avulsa
  after update of status on public.purchase_orders
  for each row execute function public.conclui_compra_avulsa_entregue();

-- ---------------------------------------------------------------------------
-- 4. `notifica_purchase_order_atualizada` (20260818110000) sempre inseria uma
--    notificação para `j.profissional_id` sem checar null — compra_equipamento
--    é o primeiro job_type sem profissional, e `notification_outbox.recipient_id`
--    é NOT NULL: todo avanço de repasse de uma compra avulsa quebraria essa
--    trigger em produção. Mesmo corpo, só com o insert do profissional
--    condicionado a ele existir.
-- ---------------------------------------------------------------------------
create or replace function public.notifica_purchase_order_atualizada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id     uuid;
  v_cliente_id uuid;
  v_prof_id    uuid;
  v_distribuidora text;
  v_payload jsonb;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select j.id, j.cliente_id, j.profissional_id
    into v_job_id, v_cliente_id, v_prof_id
    from public.orders o
    join public.jobs j on j.id = o.job_id
   where o.id = new.order_id;

  select d.razao_social into v_distribuidora
    from public.distributors d where d.id = new.distributor_id;

  v_payload := jsonb_build_object('job_id', v_job_id, 'status_novo', new.status, 'distribuidora', v_distribuidora);

  insert into public.notification_outbox (
    recipient_id, event_type, aggregate_type, aggregate_id,
    payload, dedupe_key, inapp_allowed, email_allowed, whatsapp_allowed
  )
  select r.recipient_id, 'purchase_order_updated', 'purchase_order', new.id,
         v_payload, format('po-status:%s:%s:%s', new.id, new.status, r.recipient_id), true, false, false
    from (values (v_cliente_id), (v_prof_id)) as r(recipient_id)
   where r.recipient_id is not null
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;
