-- ============================================================================
-- criar_pedido_orcamento aceita a lista de ambientes
--
-- Substitui a assinatura anterior em vez de sobrecarregá-la: com PostgREST, duas
-- versões onde a mais nova só acrescenta parâmetros com default tornam a chamada
-- ambígua e o erro aparece em produção, não aqui.
--
-- `p_itens` é um array JSON de ambientes. Vazio continua válido e cai no caminho
-- de sempre — um único ambiente montado a partir de `p_detalhes` —, então
-- qualquer chamada antiga que ainda exista segue funcionando.
-- ============================================================================

drop function if exists public.criar_pedido_orcamento(
  text, text, text, text, integer, text, text, jsonb, text, integer, uuid[], text[],
  double precision, double precision
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
  p_itens jsonb default '[]'::jsonb
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
    descricao, detalhes, produto_id, btu_recomendado
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
    nullif((v_primeiro->>'btu_recomendado')::int, 0)
  ) returning id into v_pedido_id;

  insert into public.quote_request_itens (
    quote_request_id, ordem, ambiente, area_m2, num_pessoas, eletronicos,
    insolacao_alta, andar_ou_telhado, btu_recomendado, produto_id, quantidade
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
    least(20, greatest(1, coalesce(nullif(e.item->>'quantidade', '')::int, 1)))
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
  double precision, double precision, jsonb
) from public, anon;
grant execute on function public.criar_pedido_orcamento(
  text, text, text, text, integer, text, text, jsonb, text, integer, uuid[], text[],
  double precision, double precision, jsonb
) to authenticated;

comment on function public.criar_pedido_orcamento(
  text, text, text, text, integer, text, text, jsonb, text, integer, uuid[], text[],
  double precision, double precision, jsonb
) is
  'Cria o pedido com N ambientes (p_itens). Valida cobertura, fotos e disponibilidade de cada aparelho antes de gravar; espelha o primeiro ambiente nas colunas singulares por compatibilidade.';
