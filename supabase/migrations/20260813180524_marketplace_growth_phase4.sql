-- ============================================================================
-- FASE 4 — MATCHING TERRITORIAL, CONSULTA PAGINADA E FUNIL
--
-- Decisões desta migration:
--   1. Área de atendimento é elegibilidade, não peso de ranking.
--   2. Prefixo de CEP mede cobertura, não distância geográfica.
--   3. Busca retorna componentes objetivos; pesos comerciais de ranking ficam
--      fora do banco até decisão explícita de produto.
--   4. Métricas são derivadas das fontes de verdade, sem eventos de analytics
--      gravados pelo navegador.
-- ============================================================================

set lock_timeout = '5s';
set statement_timeout = '30s';

create index if not exists idx_service_areas_professional_prefix
  on public.service_areas (professional_id, cep_prefix);

create index if not exists idx_quote_targets_professional_request
  on public.quote_request_targets (professional_id, quote_request_id);

create index if not exists idx_jobs_professional_active
  on public.jobs (profissional_id, created_at desc)
  where status in ('aguardando_profissional', 'aceito', 'em_execucao');

-- Não existe venda de destaque nem trilha de auditoria ainda. Permitir que o
-- próprio profissional insira a linha seria, na prática, liberar anúncio
-- gratuito pela REST API. Até o fluxo comercial existir, toda escrita fica
-- fechada; a leitura só considera janela e elegibilidade atuais.
drop policy if exists "featured_owner_insert" on public.featured_placements;
drop policy if exists "featured_read_all" on public.featured_placements;
create policy "featured_read_current"
  on public.featured_placements for select
  using (
    ativo
    and starts_at <= now()
    and ends_at > now()
    and public.is_featured_eligible(professional_id, specialty)
  );

revoke insert, update, delete on public.featured_placements from anon, authenticated;
alter function public.is_featured_eligible(uuid, text, numeric, integer)
  set search_path = public;

create or replace function public.profissional_atende_cep(
  p_professional_id uuid,
  p_cep text
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
      from public.service_areas sa
     where sa.professional_id = p_professional_id
       and sa.cep_prefix ~ '^[0-9]{2,5}$'
       and regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g')
             like sa.cep_prefix || '%'
  );
$$;

revoke all on function public.profissional_atende_cep(uuid, text)
  from public, anon;
grant execute on function public.profissional_atende_cep(uuid, text)
  to authenticated, service_role;

comment on function public.profissional_atende_cep(uuid, text) is
  'Verdadeiro quando ao menos um prefixo numérico cadastrado pelo profissional cobre o CEP informado.';

-- Busca paginada. A função entrega sinais independentes para a UI e para uma
-- futura política de ranking; não congela pesos comerciais prematuramente.
create or replace function public.buscar_profissionais_marketplace(
  p_cep text,
  p_specialty text default null,
  p_query text default null,
  p_sort text default 'relevancia',
  p_require_verified boolean default false,
  p_limit integer default 12,
  p_offset integer default 0
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
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with candidatos as (
    select
      pr.id,
      pr.tipo,
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
      ) as coverage_prefix_length
    from public.professionals pr
    join public.profiles pf on pf.id = pr.id
    where (select auth.uid()) is not null
      and regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g') ~ '^[0-9]{8}$'
      and public.profissional_atende_cep(pr.id, p_cep)
      and (not p_require_verified or pr.verification_status = 'verificado')
      and (p_specialty is null or exists (
        select 1 from public.professional_skills ps
         where ps.professional_id = pr.id and ps.specialty = p_specialty
      ))
      and (
        nullif(btrim(coalesce(p_query, '')), '') is null
        or pf.nome ilike '%' || btrim(p_query) || '%'
      )
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
    count(*) over () as total_count
  from candidatos c
  order by
    case when p_sort = 'servicos' then c.jobs_completed end desc,
    case when p_sort = 'resposta' then c.response_rate end desc,
    case when p_sort = 'disponibilidade' then c.active_jobs end asc,
    case when p_sort = 'nota' then c.rating_score end desc,
    case when p_sort = 'relevancia' then c.rating_score end desc,
    case when p_sort = 'relevancia' then c.response_rate end desc,
    case when p_sort = 'relevancia' then c.active_jobs end asc,
    c.jobs_completed desc,
    c.id
  limit least(24, greatest(1, coalesce(p_limit, 12)))
  offset least(10000, greatest(0, coalesce(p_offset, 0)));
$$;

revoke all on function public.buscar_profissionais_marketplace(text, text, text, text, boolean, integer, integer)
  from public, anon;
grant execute on function public.buscar_profissionais_marketplace(text, text, text, text, boolean, integer, integer)
  to authenticated;

comment on function public.buscar_profissionais_marketplace(text, text, text, text, boolean, integer, integer) is
  'Busca paginada por CEP e especialidade. Retorna sinais objetivos; destaque não altera a ordem orgânica.';

create or replace function public.buscar_produtos_marketplace(
  p_btu integer default null,
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

revoke all on function public.buscar_produtos_marketplace(integer, text, integer, integer)
  from public;
grant execute on function public.buscar_produtos_marketplace(integer, text, integer, integer)
  to anon, authenticated;

comment on function public.buscar_produtos_marketplace(integer, text, integer, integer) is
  'Catálogo público paginado, sem custo da distribuidora, ordenado por compatibilidade de BTU e preço.';

-- Reforça no banco a mesma regra mostrada pela interface. Um cliente não pode
-- contornar o matching enviando IDs arbitrários diretamente ao RPC.
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
  p_fotos text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
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
          and lower(btrim(pr.cidade)) = lower(btrim(p_cidade))
          and public.profissional_atende_cep(pr.id, v_cep)
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
    raise exception 'Um ou mais profissionais não atendem este CEP ou serviço.';
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
  text, text, text, text, integer, text, text, jsonb, text, integer, uuid[], text[]
) from public, anon;
grant execute on function public.criar_pedido_orcamento(
  text, text, text, text, integer, text, text, jsonb, text, integer, uuid[], text[]
) to authenticated;

comment on function public.criar_pedido_orcamento(
  text, text, text, text, integer, text, text, jsonb, text, integer, uuid[], text[]
) is 'Cria RFQ atomicamente e rejeita destinatários fora do CEP, cidade ou especialidade solicitada.';

-- Funil por coorte: todas as etapas partem dos pedidos criados no período.
-- Isso evita comparar denominadores de datas diferentes e produzir conversões
-- aparentemente boas, porém matematicamente inválidas.
create or replace function public.obter_funil_marketplace(
  p_days integer default 30,
  p_city text default null
)
returns table (
  period_start timestamptz,
  period_end timestamptz,
  requested bigint,
  responded bigint,
  accepted bigint,
  started bigint,
  completed bigint,
  repeat_customers bigint,
  avg_first_response_minutes numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (select public.eh_admin()) then
    raise exception 'Acesso restrito a administradores.';
  end if;

  return query
  with params as (
    select now() - make_interval(days => least(365, greatest(1, coalesce(p_days, 30)))) as since,
           now() as until
  ), cohort as (
    select q.id, q.cliente_id, q.created_at,
           min(qu.created_at) as first_response_at,
           bool_or(qu.status = 'aceita') as was_accepted,
           bool_or(j.status in ('em_execucao', 'concluido', 'avaliado')) as was_started,
           bool_or(j.status in ('concluido', 'avaliado')) as was_completed
      from public.quote_requests q
      cross join params p
      left join public.quotes qu on qu.quote_request_id = q.id
      left join public.jobs j on j.quote_request_id = q.id
     where q.created_at >= p.since and q.created_at <= p.until
       and (nullif(btrim(coalesce(p_city, '')), '') is null
            or lower(q.cidade) = lower(btrim(p_city)))
     group by q.id, q.cliente_id, q.created_at
  )
  select
    p.since,
    p.until,
    count(c.id),
    count(c.id) filter (where c.first_response_at is not null),
    count(c.id) filter (where c.was_accepted),
    count(c.id) filter (where c.was_started),
    count(c.id) filter (where c.was_completed),
    count(distinct c.cliente_id) filter (where exists (
      select 1 from public.quote_requests previous
       where previous.cliente_id = c.cliente_id
         and previous.created_at < c.created_at
    )),
    round(avg(extract(epoch from (c.first_response_at - c.created_at)) / 60)
      filter (where c.first_response_at is not null), 1)
  from params p
  left join cohort c on true
  group by p.since, p.until;
end;
$$;

revoke all on function public.obter_funil_marketplace(integer, text)
  from public, anon;
grant execute on function public.obter_funil_marketplace(integer, text)
  to authenticated;

comment on function public.obter_funil_marketplace(integer, text) is
  'Funil administrativo por coorte de pedidos, incluindo resposta, aceite, execução, conclusão e recorrência.';
