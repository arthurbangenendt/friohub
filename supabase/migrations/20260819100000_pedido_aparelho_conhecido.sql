-- ============================================================================
-- Triagem com/sem preço: "você já sabe qual aparelho deseja?"
--
-- Hoje o preço do aparelho é decidido de dois jeitos, sem meio-termo:
--   - o cliente escolhe o produto exato no catálogo (`quote_request_itens.produto_id`)
--     e o preço é 100% de `products.preco_venda` — o profissional NUNCA toca nesse
--     valor (`valor_materiais` só alimenta `orders.preco_servico`, nunca
--     `orders.preco_produto`). Ver `aceitar_quote`.
--   - ou não há produto nenhum (serviço sem catálogo, ou cliente já tem o aparelho).
--
-- Falta o terceiro caso: cliente sabe só a CATEGORIA (ex.: "quero um split"), sem
-- ver preço, e é o profissional quem escolhe o produto exato e o preço que vai
-- cobrar por ele. Para isso, `quotes` precisa de um produto e um valor de
-- aparelho PRÓPRIOS — reaproveitar `valor_materiais` botaria essa venda no bucket
-- errado (cobraria comissão de serviço em vez de rodar como produto com custo e
-- ordem de compra na distribuidora).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Uma pergunta por pedido: o cliente sabe o aparelho que quer?
-- ---------------------------------------------------------------------------
alter table public.quote_requests
  add column if not exists sabe_aparelho boolean not null default true;

comment on column public.quote_requests.sabe_aparelho is
  'true = cliente escolheu o produto exato no catálogo (preço travado). false = cliente só '
  'informou a categoria desejada; o profissional escolhe o produto e o preço na proposta. '
  'default true preserva o comportamento de todo pedido criado antes desta coluna existir.';

-- Categoria que o cliente quer, quando ele não sabe o modelo exato. Um item não
-- pode ter produto E categoria ao mesmo tempo — são os dois jeitos mutuamente
-- exclusivos de dizer "o que eu quero instalar aqui".
alter table public.quote_request_itens
  add column if not exists categoria_desejada text
    check (categoria_desejada in ('split', 'inverter', 'multi_split', 'piso_teto', 'janela'));

alter table public.quote_request_itens
  drop constraint if exists quote_request_itens_produto_xor_categoria;
alter table public.quote_request_itens
  add constraint quote_request_itens_produto_xor_categoria
  check (produto_id is null or categoria_desejada is null);

-- Espelho em `job_itens`, só para contexto no relatório de execução do job — não
-- entra em nenhum cálculo de preço (o preço já foi congelado em `preco_venda_snapshot`
-- no aceite).
alter table public.job_itens
  add column if not exists categoria_desejada text;

-- `job_itens` usa allowlist de colunas desde 20260818102000 (custo_snapshot não
-- pode vazar) — uma coluna nova só fica visível se entrar explicitamente aqui.
grant select (categoria_desejada) on public.job_itens to authenticated;

-- ---------------------------------------------------------------------------
-- 2. O que o profissional escolhe quando o cliente não sabe o aparelho
-- ---------------------------------------------------------------------------
alter table public.quotes
  add column if not exists produto_id uuid references public.products (id),
  add column if not exists valor_equipamento numeric(10,2) not null default 0
    check (valor_equipamento >= 0);

comment on column public.quotes.produto_id is
  'Produto que o profissional escolheu para cobrir a categoria pedida pelo cliente. Só '
  'usado quando quote_requests.sabe_aparelho = false — quando o cliente já escolheu o '
  'produto exato, o preço vem inteiro do catálogo e este campo fica nulo.';
comment on column public.quotes.valor_equipamento is
  'Preço que o profissional decidiu cobrar do cliente pelo produto acima — a margem dele '
  'é a diferença entre este valor e o custo real da distribuidora. Alimenta '
  'orders.preco_produto no aceite, não orders.preco_servico: é venda de aparelho, não mão '
  'de obra, e por isso não entra no cálculo de comissao_servico_pct.';

-- ---------------------------------------------------------------------------
-- 3. Trava: o profissional só mexe em produto/preço de aparelho quando o
--    cliente explicitamente disse que não sabia qual queria.
-- ---------------------------------------------------------------------------
create or replace function public.valida_aparelho_da_proposta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sabe_aparelho    boolean;
  v_precisa_aparelho boolean;
  v_categoria        text;
begin
  select r.sabe_aparelho into v_sabe_aparelho
    from public.quote_requests r
   where r.id = new.quote_request_id;

  if v_sabe_aparelho is null then
    raise exception 'Pedido de orçamento não encontrado.';
  end if;

  if v_sabe_aparelho then
    -- O cliente já escolheu o produto exato: o preço é 100%% do catálogo, e o
    -- profissional não tem o que precificar aqui.
    if new.produto_id is not null or new.valor_equipamento <> 0 then
      raise exception 'O aparelho deste pedido já foi escolhido pelo cliente com preço de catálogo — '
        'sua proposta cobre apenas a mão de obra.';
    end if;
    return new;
  end if;

  -- Cliente não sabia o aparelho: só exigimos produto+preço quando a proposta
  -- é de preço fechado e o pedido de fato tem algum ambiente sem produto
  -- definido (categoria_desejada preenchida). Visita técnica pode ser enviada
  -- sem isso — o profissional ainda não viu o local.
  select exists (
    select 1 from public.quote_request_itens i
     where i.quote_request_id = new.quote_request_id
       and i.categoria_desejada is not null
  ) into v_precisa_aparelho;

  if not v_precisa_aparelho or new.tipo <> 'preco_fechado' then
    return new;
  end if;

  if new.produto_id is null or new.valor_equipamento <= 0 then
    raise exception 'Escolha o aparelho e informe o preço que vai cobrar por ele antes de enviar uma proposta de preço fechado.';
  end if;

  select p.categoria into v_categoria from public.products p where p.id = new.produto_id;
  if v_categoria is null then
    raise exception 'Aparelho escolhido não foi encontrado no catálogo.';
  end if;
  if not exists (
    select 1 from public.quote_request_itens i
     where i.quote_request_id = new.quote_request_id
       and i.categoria_desejada = v_categoria
  ) then
    raise exception 'O aparelho escolhido não é da categoria pedida pelo cliente.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_quotes_valida_aparelho on public.quotes;
create trigger trg_quotes_valida_aparelho
  before insert or update on public.quotes
  for each row execute function public.valida_aparelho_da_proposta();

-- ---------------------------------------------------------------------------
-- 4. criar_pedido_orcamento aceita p_sabe_aparelho e categoria_desejada por item
-- ---------------------------------------------------------------------------
drop function if exists public.criar_pedido_orcamento(
  text, text, text, text, integer, text, text, jsonb, text, integer, uuid[], text[],
  double precision, double precision, jsonb
);

create function public.criar_pedido_orcamento(
  p_job_type text,
  p_cep text,
  p_cidade text,
  p_bairro text,
  p_quantidade integer,
  p_urgencia text,
  p_descricao text,
  p_detalhes jsonb,
  p_produto_id text,
  p_btu_recomendado integer,
  p_profissionais_ids uuid[],
  p_fotos text[],
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_itens jsonb default '[]'::jsonb,
  p_sabe_aparelho boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid            uuid := (select auth.uid());
  v_pedido_id      uuid;
  v_profissionais  uuid[];
  v_fotos          text[];
  v_cep            text := regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g');
  v_specialty      text;
  v_itens          jsonb;
  v_total_aparelhos int;
  v_primeiro       jsonb;
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;
  if not exists (
    select 1 from public.profiles p
     where p.id = v_uid and p.role = 'cliente'
  ) then
    raise exception 'Apenas clientes podem criar pedidos de orçamento.';
  end if;
  if v_cep !~ '^[0-9]{8}$' then
    raise exception 'Informe um CEP válido com oito dígitos.';
  end if;
  if nullif(btrim(coalesce(p_cidade, '')), '') is null then
    raise exception 'Não foi possível identificar a cidade do serviço.';
  end if;
  if (p_latitude is null) <> (p_longitude is null)
    or (p_latitude is not null and p_latitude not between -90 and 90)
    or (p_longitude is not null and p_longitude not between -180 and 180)
  then
    raise exception 'Localização do serviço inválida.';
  end if;

  -- ---- ambientes -----------------------------------------------------------
  if p_itens is not null and jsonb_typeof(p_itens) not in ('array', 'null') then
    raise exception 'A lista de ambientes precisa ser um array JSON.';
  end if;
  v_itens := coalesce(nullif(p_itens, 'null'::jsonb), '[]'::jsonb);

  -- Pedido sem lista de ambientes = o fluxo de ambiente único de sempre.
  if jsonb_array_length(v_itens) = 0 then
    v_itens := jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'ambiente',         coalesce(nullif(btrim(coalesce(p_detalhes->>'ambiente', '')), ''), 'Ambiente'),
      'area_m2',          p_detalhes->>'area_m2',
      'num_pessoas',      p_detalhes->>'num_pessoas',
      'eletronicos',      p_detalhes->>'eletronicos',
      'insolacao_alta',   coalesce(p_detalhes->>'insolacao_alta', 'false'),
      'andar_ou_telhado', coalesce(p_detalhes->>'andar_ou_telhado', 'false'),
      'btu_recomendado',  nullif(p_btu_recomendado, 0),
      'produto_id',       nullif(p_produto_id, ''),
      'quantidade',       least(100, greatest(1, coalesce(p_quantidade, 1)))
    )));
  end if;

  if jsonb_array_length(v_itens) > 20 then
    raise exception 'Um pedido de orçamento aceita no máximo 20 ambientes.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_itens) e(item)
     where jsonb_typeof(e.item) <> 'object'
        or nullif(btrim(coalesce(e.item->>'ambiente', '')), '') is null
  ) then
    raise exception 'Cada ambiente precisa ter um nome.';
  end if;

  -- Um item não pode ter produto exato E categoria genérica ao mesmo tempo —
  -- mesma regra do CHECK em quote_request_itens, verificada aqui cedo para dar
  -- mensagem legível em vez de erro de constraint.
  if exists (
    select 1 from jsonb_array_elements(v_itens) e(item)
     where nullif(e.item->>'produto_id', '') is not null
       and nullif(e.item->>'categoria_desejada', '') is not null
  ) then
    raise exception 'Cada ambiente tem ou um produto escolhido, ou uma categoria desejada — nunca os dois.';
  end if;

  /* Um aparelho indisponível precisa reprovar o pedido AQUI. Descobrir isso só
     no aceite significa o cliente já ter comparado propostas montadas sobre um
     produto que não existe mais. */
  if exists (
    select 1
      from jsonb_array_elements(v_itens) e(item)
     where nullif(e.item->>'produto_id', '') is not null
       and not exists (
         select 1
           from public.products pr
           join public.distributors d on d.id = pr.distributor_id
          where pr.id = (e.item->>'produto_id')::uuid
            and pr.ativo
            and pr.estoque_disponivel
            and d.ativo
            and d.verification_status = 'verificado'
       )
  ) then
    raise exception 'Um dos aparelhos escolhidos não está mais disponível.';
  end if;

  -- ---- destinatários -------------------------------------------------------
  v_specialty := case p_job_type
    when 'instalacao_com_equipamento' then 'instalacao'
    when 'troca_equipamento' then 'instalacao'
    when 'manutencao' then 'manutencao'
    when 'remanejamento' then 'remanejamento'
    when 'limpeza' then 'limpeza'
    when 'conserto' then 'conserto'
    else null
  end;

  select coalesce(array_agg(x order by x), '{}'::uuid[])
    into v_profissionais
    from (select distinct unnest(coalesce(p_profissionais_ids, '{}'::uuid[])) x) s;

  if cardinality(v_profissionais) not between 1 and 5 then
    raise exception 'Escolha entre um e cinco profissionais.';
  end if;

  if exists (
    select 1
      from unnest(v_profissionais) chosen(professional_id)
     where not exists (
       select 1
         from public.professionals pr
        where pr.id = chosen.professional_id
          and public.profissional_atende_local(pr.id, v_cep, p_latitude, p_longitude)
          and (
            v_specialty is null
            or exists (
              select 1 from public.professional_skills ps
               where ps.professional_id = pr.id
                 and ps.specialty = v_specialty
            )
          )
     )
  ) then
    raise exception 'Um ou mais profissionais não atendem esta localização ou serviço.';
  end if;

  -- ---- fotos ---------------------------------------------------------------
  select coalesce(array_agg(x order by x), '{}'::text[])
    into v_fotos
    from (select distinct unnest(coalesce(p_fotos, '{}'::text[])) x) s;

  if cardinality(v_fotos) > 6 then
    raise exception 'Cada pedido pode ter no máximo seis fotos.';
  end if;
  if exists (
    select 1 from unnest(v_fotos) f(path)
     where f.path not like v_uid::text || '/%'
        or not exists (
          select 1 from storage.objects o
           where o.bucket_id = 'orcamentos' and o.name = f.path
        )
  ) then
    raise exception 'Uma ou mais fotos são inválidas ou não pertencem ao cliente.';
  end if;

  -- ---- pedido --------------------------------------------------------------
  /* `quantidade` deixa de ser digitada e passa a ser a soma real dos ambientes:
     era o único número que dizia "quantos aparelhos", e agora os itens sabem
     isso com precisão. */
  select coalesce(sum(least(20, greatest(1, coalesce((e.item->>'quantidade')::int, 1)))), 1)
    into v_total_aparelhos
    from jsonb_array_elements(v_itens) e(item);

  v_primeiro := v_itens->0;

  insert into public.quote_requests (
    cliente_id, job_type, cep, cidade, bairro, quantidade, urgencia,
    descricao, detalhes, produto_id, btu_recomendado, sabe_aparelho
  ) values (
    v_uid,
    p_job_type,
    v_cep,
    btrim(p_cidade),
    nullif(btrim(p_bairro), ''),
    least(100, greatest(1, v_total_aparelhos)),
    nullif(btrim(p_urgencia), ''),
    nullif(btrim(p_descricao), ''),
    /* As chaves singulares seguem espelhando o primeiro ambiente. É isso que
       mantém `aceitar_quote` e as telas antigas funcionando sem alteração. */
    coalesce(p_detalhes, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'ambiente',         v_primeiro->>'ambiente',
      'area_m2',          v_primeiro->>'area_m2',
      'num_pessoas',      v_primeiro->>'num_pessoas',
      'eletronicos',      v_primeiro->>'eletronicos',
      'insolacao_alta',   v_primeiro->>'insolacao_alta',
      'andar_ou_telhado', v_primeiro->>'andar_ou_telhado'
    )),
    nullif(v_primeiro->>'produto_id', '')::uuid,
    nullif((v_primeiro->>'btu_recomendado')::int, 0),
    coalesce(p_sabe_aparelho, true)
  ) returning id into v_pedido_id;

  insert into public.quote_request_itens (
    quote_request_id, ordem, ambiente, area_m2, num_pessoas, eletronicos,
    insolacao_alta, andar_ou_telhado, btu_recomendado, produto_id, quantidade,
    categoria_desejada
  )
  select
    v_pedido_id,
    e.ordinality::int,
    btrim(e.item->>'ambiente'),
    nullif(e.item->>'area_m2', '')::numeric,
    nullif(e.item->>'num_pessoas', '')::int,
    nullif(e.item->>'eletronicos', '')::int,
    coalesce(nullif(e.item->>'insolacao_alta', '')::boolean, false),
    coalesce(nullif(e.item->>'andar_ou_telhado', '')::boolean, false),
    nullif(nullif(e.item->>'btu_recomendado', '')::int, 0),
    nullif(e.item->>'produto_id', '')::uuid,
    least(20, greatest(1, coalesce(nullif(e.item->>'quantidade', '')::int, 1))),
    nullif(e.item->>'categoria_desejada', '')
    from jsonb_array_elements(v_itens) with ordinality as e(item, ordinality);

  insert into public.quote_request_targets (quote_request_id, professional_id)
  select v_pedido_id, unnest(v_profissionais);

  insert into public.quote_request_photos (quote_request_id, storage_path)
  select v_pedido_id, unnest(v_fotos);

  return v_pedido_id;
end;
$$;

revoke all on function public.criar_pedido_orcamento(
  text, text, text, text, integer, text, text, jsonb, text, integer, uuid[], text[],
  double precision, double precision, jsonb, boolean
) from public, anon;
grant execute on function public.criar_pedido_orcamento(
  text, text, text, text, integer, text, text, jsonb, text, integer, uuid[], text[],
  double precision, double precision, jsonb, boolean
) to authenticated;

comment on function public.criar_pedido_orcamento(
  text, text, text, text, integer, text, text, jsonb, text, integer, uuid[], text[],
  double precision, double precision, jsonb, boolean
) is
  'Cria o pedido com N ambientes (p_itens). p_sabe_aparelho decide se o preço do catálogo '
  'fica travado (true) ou se o profissional escolhe produto e preço na proposta (false). '
  'Valida cobertura, fotos e disponibilidade de cada aparelho antes de gravar.';

-- ---------------------------------------------------------------------------
-- 5. aceitar_quote passa a cobrir o aparelho escolhido pelo PROFISSIONAL, nos
--    itens em que o cliente só informou a categoria desejada.
-- ---------------------------------------------------------------------------
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
     o CLIENTE escolheu quanto o que o PROFISSIONAL escolheu na proposta. */
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

  perform 1
     from public.quote_request_itens i
     join public.products p
       on p.id = coalesce(i.produto_id, case when i.categoria_desejada is not null then v_quote.produto_id end)
     join public.distributors d on d.id = p.distributor_id
    where i.quote_request_id = v_req.id
    for share of p, d;

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

comment on function public.aceitar_quote(uuid, text, jsonb) is
  'Aceite serializado por quote_request. Congela o escopo em job_itens, soma produto e '
  'margem na order e abre uma purchase_order por distribuidora. Quando o cliente não sabia '
  'o aparelho (sabe_aparelho=false), usa o produto e o preço que o PROFISSIONAL escolheu na '
  'proposta (quotes.produto_id / valor_equipamento) em vez do que o cliente escolheu.';

-- ---------------------------------------------------------------------------
-- 6. Catálogo sem preço, para o cliente que ainda não sabe o que quer.
--    RETURNS TABLE sem coluna de preço: a garantia de não vazar valor é
--    estrutural, não uma omissão no frontend.
-- ---------------------------------------------------------------------------
create or replace function public.buscar_produtos_marketplace_sem_preco(
  p_btu integer default null,
  p_categoria text default null,
  p_query text default null,
  p_limit integer default 12,
  p_offset integer default 0
)
returns table (
  product_id uuid,
  marca text,
  modelo text,
  btu integer,
  categoria text,
  image_url text,
  distribuidora text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id,
    p.marca,
    p.modelo,
    p.btu,
    p.categoria,
    p.image_url,
    d.razao_social,
    count(*) over ()
  from public.products p
  left join public.distributors d on d.id = p.distributor_id
  where p.ativo and p.estoque_disponivel
    and (p_categoria is null or p.categoria = p_categoria)
    and (
      nullif(btrim(coalesce(p_query, '')), '') is null
      or concat_ws(' ', p.marca, p.modelo, d.razao_social)
           ilike '%' || btrim(p_query) || '%'
    )
  order by
    case when p_btu is not null and p.btu = p_btu then 0 else 1 end,
    case when p_btu is not null then abs(p.btu - p_btu) else p.btu end,
    p.id
  limit least(24, greatest(1, coalesce(p_limit, 12)))
  offset least(10000, greatest(0, coalesce(p_offset, 0)));
$$;

revoke all on function public.buscar_produtos_marketplace_sem_preco(integer, text, text, integer, integer)
  from public;
grant execute on function public.buscar_produtos_marketplace_sem_preco(integer, text, text, integer, integer)
  to anon, authenticated;

comment on function public.buscar_produtos_marketplace_sem_preco(integer, text, text, integer, integer) is
  'Mesmo catálogo de buscar_produtos_marketplace, sem a coluna de preço — usado quando o '
  'cliente ainda não sabe qual aparelho quer e não deve ver valores.';

-- Também deixa o profissional filtrar o catálogo COM preço por categoria, para
-- montar a proposta do fluxo "não sabe o aparelho" só com produtos da
-- categoria que o cliente pediu. `create or replace` não serve aqui: adicionar
-- um parâmetro muda a identidade da função para o Postgres, e as duas versões
-- ficariam coexistindo e ambíguas para o PostgREST — precisa dropar a antiga
-- primeiro, mesmo padrão já usado em criar_pedido_orcamento.
drop function if exists public.buscar_produtos_marketplace(integer, text, integer, integer);

create function public.buscar_produtos_marketplace(
  p_btu integer default null,
  p_query text default null,
  p_limit integer default 12,
  p_offset integer default 0,
  p_categoria text default null
)
returns table (
  product_id uuid,
  marca text,
  modelo text,
  btu integer,
  categoria text,
  preco_venda numeric,
  image_url text,
  distribuidora text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id,
    p.marca,
    p.modelo,
    p.btu,
    p.categoria,
    p.preco_venda,
    p.image_url,
    d.razao_social,
    count(*) over ()
  from public.products p
  left join public.distributors d on d.id = p.distributor_id
  where p.ativo and p.estoque_disponivel
    and (p_categoria is null or p.categoria = p_categoria)
    and (
      nullif(btrim(coalesce(p_query, '')), '') is null
      or concat_ws(' ', p.marca, p.modelo, d.razao_social)
           ilike '%' || btrim(p_query) || '%'
    )
  order by
    case when p_btu is not null and p.btu = p_btu then 0 else 1 end,
    case when p_btu is not null then abs(p.btu - p_btu) else p.btu end,
    p.preco_venda,
    p.id
  limit least(24, greatest(1, coalesce(p_limit, 12)))
  offset least(10000, greatest(0, coalesce(p_offset, 0)));
$$;

revoke all on function public.buscar_produtos_marketplace(integer, text, integer, integer, text)
  from public;
grant execute on function public.buscar_produtos_marketplace(integer, text, integer, integer, text)
  to anon, authenticated;

comment on function public.buscar_produtos_marketplace(integer, text, integer, integer, text) is
  'Catálogo público paginado, sem custo da distribuidora, ordenado por compatibilidade de '
  'BTU e preço. p_categoria filtra por categoria — usado pelo profissional ao montar '
  'proposta no fluxo em que o cliente não sabia qual aparelho queria.';
