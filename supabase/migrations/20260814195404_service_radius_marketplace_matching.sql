-- Matching territorial por raio real.
--
-- As coordenadas privadas da base do profissional nunca saem desta camada. A
-- API recebe somente a resposta de elegibilidade (raio ou CEP legado). As
-- coordenadas do cliente são usadas durante a chamada e não são persistidas.

set lock_timeout = '5s';
set statement_timeout = '30s';

create or replace function public.distancia_coordenadas_km(
  p_latitude_origem double precision,
  p_longitude_origem double precision,
  p_latitude_destino double precision,
  p_longitude_destino double precision
)
returns double precision
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select 6371.0088 * 2 * asin(sqrt(
    least(1.0, greatest(0.0,
      power(sin(radians(p_latitude_destino - p_latitude_origem) / 2), 2)
      + cos(radians(p_latitude_origem))
        * cos(radians(p_latitude_destino))
        * power(sin(radians(p_longitude_destino - p_longitude_origem) / 2), 2)
    ))
  ));
$$;

revoke all on function public.distancia_coordenadas_km(
  double precision, double precision, double precision, double precision
) from public, anon, authenticated;

comment on function public.distancia_coordenadas_km(
  double precision, double precision, double precision, double precision
) is 'Distância Haversine interna em quilômetros; não expõe coordenadas armazenadas.';

create or replace function public.profissional_atende_local(
  p_professional_id uuid,
  p_cep text,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when r.professional_id is not null
      and p_latitude between -90 and 90
      and p_longitude between -180 and 180
    then public.distancia_coordenadas_km(
      p_latitude,
      p_longitude,
      r.latitude::double precision,
      r.longitude::double precision
    ) <= r.radius_km::double precision
    else public.profissional_atende_cep(p_professional_id, p_cep)
  end
  from (select 1) seed
  left join public.professional_service_radius r
    on r.professional_id = p_professional_id;
$$;

-- Esta função lê a tabela privada, mas é somente um bloco interno das duas
-- operações abaixo. Não pode virar um oráculo público de geolocalização.
revoke all on function public.profissional_atende_local(
  uuid, text, double precision, double precision
) from public, anon, authenticated;

comment on function public.profissional_atende_local(
  uuid, text, double precision, double precision
) is 'Valida raio privado quando há coordenadas; usa prefixo de CEP apenas para profissionais legados.';

drop function if exists public.buscar_profissionais_marketplace(
  text, text, text, text, boolean, integer, integer
);

create function public.buscar_profissionais_marketplace(
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
) is 'Ranking quality_v1 com elegibilidade por raio privado; profissionais legados usam prefixo de CEP.';

drop function if exists public.criar_pedido_orcamento(
  text, text, text, text, integer, text, text, jsonb, text, integer, uuid[], text[]
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
  p_longitude double precision default null
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
  v_cep             text := regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g');
  v_specialty       text;
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

  insert into public.quote_requests (
    cliente_id, job_type, cep, cidade, bairro, quantidade, urgencia,
    descricao, detalhes, produto_id, btu_recomendado
  ) values (
    v_uid,
    p_job_type,
    v_cep,
    btrim(p_cidade),
    nullif(btrim(p_bairro), ''),
    least(100, greatest(1, coalesce(p_quantidade, 1))),
    nullif(btrim(p_urgencia), ''),
    nullif(btrim(p_descricao), ''),
    coalesce(p_detalhes, '{}'::jsonb),
    nullif(p_produto_id, '')::uuid,
    nullif(p_btu_recomendado, 0)
  ) returning id into v_pedido_id;

  insert into public.quote_request_targets (quote_request_id, professional_id)
  select v_pedido_id, unnest(v_profissionais);

  insert into public.quote_request_photos (quote_request_id, storage_path)
  select v_pedido_id, unnest(v_fotos);

  return v_pedido_id;
end;
$$;

revoke all on function public.criar_pedido_orcamento(
  text, text, text, text, integer, text, text, jsonb, text, integer, uuid[], text[],
  double precision, double precision
) from public, anon;
grant execute on function public.criar_pedido_orcamento(
  text, text, text, text, integer, text, text, jsonb, text, integer, uuid[], text[],
  double precision, double precision
) to authenticated;

comment on function public.criar_pedido_orcamento(
  text, text, text, text, integer, text, text, jsonb, text, integer, uuid[], text[],
  double precision, double precision
) is 'Cria RFQ atomicamente e revalida especialidade e cobertura por raio/CEP sem persistir coordenadas.';
