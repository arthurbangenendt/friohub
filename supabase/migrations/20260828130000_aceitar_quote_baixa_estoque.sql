-- ============================================================================
-- `aceitar_quote` passa a dar baixa em `estoque_quantidade`
--
-- Antes, a revalidação de disponibilidade (bloco "Todo aparelho do pedido é
-- revalidado...") só lia o booleano `estoque_disponivel` e travava as linhas
-- de produto com FOR SHARE — suficiente pra evitar leitura suja, mas não pra
-- decrementar quantidade com segurança: dois aceites concorrentes para o
-- último item em estoque passavam ambos pela checagem antes de qualquer um
-- travar a linha para escrita.
--
-- Esta versão troca o lock para FOR UPDATE, reconfirma a quantidade DEPOIS de
-- travar (fecha a janela de corrida) e decrementa `estoque_quantidade` por
-- SKU. Produto em modo booleano legado (`estoque_quantidade is null`) segue
-- sem baixa nenhuma — comportamento inalterado. Ver
-- 20260828120000_estoque_quantidade.sql.
-- ============================================================================

create or replace function public.aceitar_quote(
  p_quote_id uuid,
  p_endereco text,
  p_detalhes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote       public.quotes%rowtype;
  v_req         public.quote_requests%rowtype;
  v_pct         numeric;
  v_servico     numeric(10,2);
  v_venda       numeric(10,2) := 0;
  v_custo       numeric(10,2) := 0;
  v_job_id      uuid;
  v_order_id    uuid;
  v_request_id  uuid;
  v_detalhes    jsonb;
  v_primeiro    public.quote_request_itens%rowtype;
  v_indisponivel text;
  v_qtd_sem_produto int;
begin
  if (select auth.uid()) is null then
    raise exception 'Não autenticado.';
  end if;
  if nullif(btrim(coalesce(p_endereco, '')), '') is null then
    raise exception 'Informe o endereço completo do serviço.';
  end if;
  if char_length(p_endereco) > 500 then
    raise exception 'O endereço informado é muito longo.';
  end if;
  if p_detalhes is not null and jsonb_typeof(p_detalhes) <> 'object' then
    raise exception 'Detalhes técnicos precisam ser um objeto JSON.';
  end if;

  -- Lock do pedido antes do lock da proposta: chamadas concorrentes para
  -- propostas diferentes do mesmo pedido serializam aqui.
  select q.quote_request_id into v_request_id
    from public.quotes q
   where q.id = p_quote_id;
  if not found then
    raise exception 'Proposta não encontrada.';
  end if;

  select * into v_req
    from public.quote_requests
   where id = v_request_id
   for update;

  select * into v_quote
    from public.quotes
   where id = p_quote_id
     and quote_request_id = v_req.id
   for update;

  if not found then
    raise exception 'Proposta não encontrada.';
  end if;
  if v_req.cliente_id is distinct from (select auth.uid()) then
    raise exception 'Apenas o cliente do pedido pode aceitar a proposta.';
  end if;
  if v_req.status <> 'aberto' then
    raise exception 'Este pedido de orçamento já foi encerrado.';
  end if;
  if v_req.expira_em <= now() then
    raise exception 'Este pedido de orçamento expirou.';
  end if;
  if v_quote.status <> 'enviada' then
    raise exception 'Esta proposta não está mais disponível.';
  end if;
  if v_quote.validade_ate < current_date then
    raise exception 'Esta proposta venceu em %.', to_char(v_quote.validade_ate, 'DD/MM/YYYY');
  end if;

  v_detalhes := coalesce(v_req.detalhes, '{}'::jsonb) || coalesce(p_detalhes, '{}'::jsonb);

  v_servico := case
    when v_quote.tipo = 'visita_tecnica' then v_quote.valor_visita
    else v_quote.valor_mao_obra + v_quote.valor_materiais
  end;

  /* Todo aparelho do pedido é revalidado e travado agora. Um único item fora de
     estoque reprova o aceite inteiro: entregar 2 de 3 ambientes e cobrar por um
     pacote que não existe mais é pior do que recusar. Cobre tanto o produto que
     o CLIENTE escolheu quanto o que o PROFISSIONAL escolheu na proposta.
     Checagem booleana rápida, antes do lock — a autoritativa (com quantidade)
     vem depois de travar as linhas, abaixo. */
  select string_agg(distinct i.ambiente, ', ' order by i.ambiente)
    into v_indisponivel
    from public.quote_request_itens i
   where i.quote_request_id = v_req.id
     and coalesce(i.produto_id, case when i.categoria_desejada is not null then v_quote.produto_id end) is not null
     and not exists (
       select 1
         from public.products p
         join public.distributors d on d.id = p.distributor_id
        where p.id = coalesce(i.produto_id, v_quote.produto_id)
          and p.ativo
          and p.estoque_disponivel
          and d.ativo
          and d.verification_status = 'verificado'
     );

  if v_indisponivel is not null then
    raise exception 'O equipamento escolhido para % não está mais disponível.', v_indisponivel;
  end if;

  /* FOR UPDATE (não mais FOR SHARE): a baixa de estoque abaixo precisa ser
     atômica por SKU. Com FOR SHARE, dois aceites concorrentes para o último
     item com quantidade controlada podiam ambos passar pela checagem acima
     antes de qualquer um conseguir escrever. */
  perform 1
     from public.quote_request_itens i
     join public.products p
       on p.id = coalesce(i.produto_id, case when i.categoria_desejada is not null then v_quote.produto_id end)
     join public.distributors d on d.id = p.distributor_id
    where i.quote_request_id = v_req.id
    for update of p, d;

  /* Reconfere agora que as linhas de produto estão travadas — fecha a janela
     de corrida entre a checagem booleana acima e este lock. Só reprova por
     quantidade quando o produto está em modo de quantidade controlada
     (estoque_quantidade not null); modo booleano legado já foi coberto acima. */
  select string_agg(distinct i.ambiente, ', ' order by i.ambiente)
    into v_indisponivel
    from public.quote_request_itens i
    join public.products p
      on p.id = coalesce(i.produto_id, case when i.categoria_desejada is not null then v_quote.produto_id end)
   where i.quote_request_id = v_req.id
     and p.estoque_quantidade is not null
     and p.estoque_quantidade < i.quantidade;

  if v_indisponivel is not null then
    raise exception 'O equipamento escolhido para % não tem quantidade suficiente em estoque.', v_indisponivel;
  end if;

  select * into v_primeiro
    from public.quote_request_itens
   where quote_request_id = v_req.id
   order by ordem
   limit 1;

  -- Colunas singulares de `jobs` seguem espelhando o primeiro ambiente.
  insert into public.jobs (
    quote_request_id,
    cliente_id, job_type, has_equipment, cep, endereco, cidade, descricao,
    produto_id, btu_recomendado, area_m2, ambiente, num_pessoas,
    insolacao_alta, andar_ou_telhado,
    profissional_id, status
  ) values (
    v_req.id,
    v_req.cliente_id, v_req.job_type,
    exists (
      select 1 from public.quote_request_itens i
       where i.quote_request_id = v_req.id
         and coalesce(i.produto_id, case when i.categoria_desejada is not null then v_quote.produto_id end) is not null
    ),
    v_req.cep,
    btrim(p_endereco), v_req.cidade, v_req.descricao,
    coalesce(v_primeiro.produto_id, case when v_primeiro.categoria_desejada is not null then v_quote.produto_id end, v_req.produto_id),
    coalesce(v_primeiro.btu_recomendado, v_req.btu_recomendado),
    coalesce(v_primeiro.area_m2,    nullif(v_detalhes->>'area_m2', '')::numeric),
    coalesce(v_primeiro.ambiente,   nullif(v_detalhes->>'ambiente', '')),
    coalesce(v_primeiro.num_pessoas, nullif(v_detalhes->>'num_pessoas', '')::int),
    coalesce(v_primeiro.insolacao_alta,   nullif(v_detalhes->>'insolacao_alta', '')::boolean),
    coalesce(v_primeiro.andar_ou_telhado, nullif(v_detalhes->>'andar_ou_telhado', '')::boolean),
    v_quote.professional_id, 'aguardando_profissional'
  )
  returning id into v_job_id;

  -- Quantidade total dos itens em que é o profissional quem está definindo o
  -- aparelho — é sobre essa soma que `valor_equipamento` é distribuído
  -- proporcionalmente, do mesmo jeito que `valor_mao_obra` já é um valor único
  -- para o pacote inteiro em vez de por ambiente.
  select coalesce(sum(i.quantidade), 0) into v_qtd_sem_produto
    from public.quote_request_itens i
   where i.quote_request_id = v_req.id
     and i.produto_id is null
     and i.categoria_desejada is not null;

  insert into public.job_itens (
    job_id, ordem, ambiente, area_m2, num_pessoas, eletronicos,
    insolacao_alta, andar_ou_telhado, btu_recomendado, produto_id, quantidade,
    categoria_desejada, preco_venda_snapshot, custo_snapshot, distributor_id
  )
  select
    v_job_id, i.ordem, i.ambiente, i.area_m2, i.num_pessoas, i.eletronicos,
    i.insolacao_alta, i.andar_ou_telhado, i.btu_recomendado,
    coalesce(i.produto_id, case when i.categoria_desejada is not null then v_quote.produto_id end),
    i.quantidade,
    i.categoria_desejada,
    case
      when i.produto_id is not null then coalesce(p.preco_venda, 0) * i.quantidade
      when i.categoria_desejada is not null and v_quote.produto_id is not null and v_qtd_sem_produto > 0
        then round(v_quote.valor_equipamento * i.quantidade / v_qtd_sem_produto, 2)
      else 0
    end,
    coalesce(p.custo, 0) * i.quantidade,
    p.distributor_id
    from public.quote_request_itens i
    left join public.products p
      on p.id = coalesce(i.produto_id, case when i.categoria_desejada is not null then v_quote.produto_id end)
   where i.quote_request_id = v_req.id
   order by i.ordem;

  -- Baixa a quantidade reservada por SKU (soma quando o mesmo produto aparece
  -- em mais de um ambiente do pedido). Produto em modo booleano legado
  -- (estoque_quantidade is null) não é tocado — `protege_produto` só deriva
  -- estoque_disponivel quando a quantidade é preenchida.
  update public.products p
     set estoque_quantidade = p.estoque_quantidade - t.qtd
    from (
      select coalesce(i.produto_id, case when i.categoria_desejada is not null then v_quote.produto_id end) as produto_id,
             sum(i.quantidade) as qtd
        from public.quote_request_itens i
       where i.quote_request_id = v_req.id
       group by 1
    ) t
   where p.id = t.produto_id
     and p.estoque_quantidade is not null;

  select coalesce(sum(preco_venda_snapshot), 0), coalesce(sum(custo_snapshot), 0)
    into v_venda, v_custo
    from public.job_itens
   where job_id = v_job_id;

  select pc.comissao_servico_pct into v_pct
    from public.platform_config pc
   where pc.id;

  insert into public.orders (
    job_id, preco_produto, preco_servico, comissao_servico, margem_produto, total, payment_status
  ) values (
    v_job_id,
    v_venda,
    v_servico,
    round(v_servico * coalesce(v_pct, 0.15), 2),
    v_venda - v_custo,
    v_venda + v_servico,
    'pendente'
  )
  returning id into v_order_id;

  -- Uma ordem de compra por distribuidora envolvida, com o custo somado dos
  -- itens dela e o maior prazo entre eles.
  insert into public.purchase_orders (
    order_id, distributor_id, custo_snapshot, prazo_previsto
  )
  select
    v_order_id,
    ji.distributor_id,
    sum(ji.custo_snapshot),
    current_date + coalesce(max(d.prazo_entrega_dias), 5)
    from public.job_itens ji
    join public.distributors d on d.id = ji.distributor_id
   where ji.job_id = v_job_id
     and ji.distributor_id is not null
   group by ji.distributor_id;

  update public.quotes
     set status = 'aceita', job_id = v_job_id
   where id = p_quote_id;

  update public.quotes
     set status = 'recusada'
   where quote_request_id = v_req.id
     and id <> p_quote_id
     and status = 'enviada';

  update public.quote_requests
     set status = 'fechado', detalhes = v_detalhes
   where id = v_req.id;

  return v_job_id;
end;
$$;
