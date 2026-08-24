-- ============================================================================
-- Consequência real da inadimplência: sumir da busca e não poder ser alvo de
-- pedido de orçamento novo
-- ============================================================================
--
-- `professionals.subscription_status = 'inadimplente'` é escrito por
-- `processar_evento_gateway` no evento `PAYMENT_OVERDUE` desde a assinatura
-- de planos existir, mas até aqui nunca era lido em lugar nenhum — os dois
-- RPCs abaixo são `security definer`, então a trava tem que estar dentro
-- deles: checar só na UI não protege nada, quem chama a RPC/Edge Function
-- direto contornaria.

-- ---------------------------------------------------------------------------
-- 1. buscar_profissionais_marketplace — inadimplente some da busca
-- ---------------------------------------------------------------------------
create or replace function public.buscar_profissionais_marketplace(
  p_cep text,
  p_specialty text default null,
  p_query text default null,
  p_sort text default 'relevancia',
  p_require_verified boolean default false,
  p_limit integer default 12,
  p_offset integer default 0,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns table (
  professional_id uuid,
  tipo text,
  nome text,
  bio text,
  avatar_url text,
  foto_url text,
  skills jsonb,
  destaque_em text[],
  rating_score numeric,
  jobs_completed integer,
  response_rate numeric,
  active_jobs integer,
  coverage_prefix_length integer,
  coverage_mode text,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with candidatos as (
    select
      pr.id,
      pr.tipo,
      pr.verification_status,
      pf.nome,
      pr.bio,
      pf.avatar_url,
      (
        select pi.url
          from public.portfolio_items pi
         where pi.professional_id = pr.id and pi.media_type = 'foto'
         order by pi.position, pi.created_at
         limit 1
      ) as foto_url,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'specialty', ps.specialty,
            'ratingAvg', ps.rating_avg,
            'ratingCount', ps.rating_count,
            'jobsCompleted', ps.jobs_completed,
            'yearsExperience', ps.years_experience
          ) order by ps.specialty
        )
          from public.professional_skills ps
         where ps.professional_id = pr.id
      ), '[]'::jsonb) as skills,
      coalesce((
        select array_agg(fp.specialty order by fp.specialty)
          from public.featured_placements fp
         where fp.professional_id = pr.id
           and fp.ativo
           and fp.starts_at <= now()
           and fp.ends_at > now()
           and public.is_featured_eligible(fp.professional_id, fp.specialty)
      ), '{}'::text[]) as destaque_em,
      coalesce((
        select max(ps.rating_avg)
          from public.professional_skills ps
         where ps.professional_id = pr.id
           and (p_specialty is null or ps.specialty = p_specialty)
      ), 0)::numeric as rating_score,
      coalesce((
        select max(ps.rating_count)
          from public.professional_skills ps
         where ps.professional_id = pr.id
           and (p_specialty is null or ps.specialty = p_specialty)
      ), 0)::integer as rating_count_signal,
      coalesce((
        select max(ps.jobs_completed)
          from public.professional_skills ps
         where ps.professional_id = pr.id
           and (p_specialty is null or ps.specialty = p_specialty)
      ), 0)::integer as jobs_completed,
      coalesce((
        select round(
          count(distinct qu.quote_request_id)::numeric
          / nullif(count(distinct t.quote_request_id), 0), 4
        )
          from public.quote_request_targets t
          left join public.quotes qu
            on qu.quote_request_id = t.quote_request_id
           and qu.professional_id = t.professional_id
         where t.professional_id = pr.id
      ), 0)::numeric as response_rate,
      (
        select count(distinct t.quote_request_id)::integer
          from public.quote_request_targets t
         where t.professional_id = pr.id
      ) as target_count_signal,
      (
        select count(*)::integer
          from public.jobs j
         where j.profissional_id = pr.id
           and j.status in ('aguardando_profissional', 'aceito', 'em_execucao')
      ) as active_jobs,
      (
        select max(length(sa.cep_prefix))::integer
          from public.service_areas sa
         where sa.professional_id = pr.id
           and sa.cep_prefix ~ '^[0-9]{2,5}$'
           and regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g')
                 like sa.cep_prefix || '%'
      ) as coverage_prefix_length,
      case
        when p_latitude between -90 and 90
          and p_longitude between -180 and 180
          and exists (
            select 1 from public.professional_service_radius r
             where r.professional_id = pr.id
          )
        then 'raio'
        else 'cep'
      end as coverage_mode
    from public.professionals pr
    join public.profiles pf on pf.id = pr.id
    where (select auth.uid()) is not null
      and regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g') ~ '^[0-9]{8}$'
      and public.profissional_atende_local(pr.id, p_cep, p_latitude, p_longitude)
      and (not p_require_verified or pr.verification_status = 'verificado')
      and coalesce(pr.subscription_status, 'ativa') <> 'inadimplente'
      and (p_specialty is null or exists (
        select 1 from public.professional_skills ps
         where ps.professional_id = pr.id and ps.specialty = p_specialty
      ))
      and (
        nullif(btrim(coalesce(p_query, '')), '') is null
        or pf.nome ilike '%' || btrim(p_query) || '%'
      )
  ), pontuados as (
    select c.*,
      (
        (
          0.60 * (
            0.80 * (
              ((c.rating_score * c.rating_count_signal) + (4.0 * 5))
              / (c.rating_count_signal + 5) / 5.0
            )
            + 0.20 * least(1.0, ln(1 + c.jobs_completed) / ln(51))
          )
          + 0.25 * (
            ((c.response_rate * c.target_count_signal) + 2.0)
            / (c.target_count_signal + 4.0)
          )
          + 0.15 * (1.0 / (1 + c.active_jobs))
        ) * case when c.verification_status = 'verificado' then 1.0 else 0.85 end
      )::numeric as organic_score
    from candidatos c
  )
  select
    c.id,
    c.tipo,
    c.nome,
    c.bio,
    c.avatar_url,
    c.foto_url,
    c.skills,
    c.destaque_em,
    c.rating_score,
    c.jobs_completed,
    c.response_rate,
    c.active_jobs,
    c.coverage_prefix_length,
    c.coverage_mode,
    count(*) over () as total_count
  from pontuados c
  order by
    case when p_sort = 'servicos' then c.jobs_completed end desc,
    case when p_sort = 'resposta' then c.response_rate end desc,
    case when p_sort = 'disponibilidade' then c.active_jobs end asc,
    case when p_sort = 'nota' then c.rating_score end desc,
    case when p_sort = 'relevancia' then c.organic_score end desc,
    c.jobs_completed desc,
    c.id
  limit least(24, greatest(1, coalesce(p_limit, 12)))
  offset least(10000, greatest(0, coalesce(p_offset, 0)));
$$;

revoke all on function public.buscar_profissionais_marketplace(
  text, text, text, text, boolean, integer, integer, double precision, double precision
) from public, anon;
grant execute on function public.buscar_profissionais_marketplace(
  text, text, text, text, boolean, integer, integer, double precision, double precision
) to authenticated;

comment on function public.buscar_profissionais_marketplace(
  text, text, text, text, boolean, integer, integer, double precision, double precision
) is 'Ranking quality_v1 com elegibilidade por raio privado; profissionais legados usam prefixo de CEP. Inadimplente não aparece.';

-- ---------------------------------------------------------------------------
-- 2. criar_pedido_orcamento — inadimplente não pode ser alvo de pedido novo
-- ---------------------------------------------------------------------------
create or replace function public.criar_pedido_orcamento(
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

  -- Inadimplente não pode ser alvo de pedido novo — checagem separada da de
  -- localização/especialidade acima para não confundir as duas mensagens.
  if exists (
    select 1 from unnest(v_profissionais) chosen(professional_id)
    join public.professionals pr on pr.id = chosen.professional_id
    where coalesce(pr.subscription_status, 'ativa') = 'inadimplente'
  ) then
    raise exception 'Um profissional selecionado está temporariamente indisponível.';
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
  'Valida cobertura, fotos, disponibilidade de cada aparelho e inadimplência antes de gravar.';
