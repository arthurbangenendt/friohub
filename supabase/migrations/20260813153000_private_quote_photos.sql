-- ============================================================================
-- FOTOS PRIVADAS DE ORÇAMENTO + CRIAÇÃO ATÔMICA DO PEDIDO
--
-- A tabela passa a guardar o caminho interno do objeto. A UI obtém URLs
-- assinadas somente depois que a RLS confirma que o usuário participa do pedido.
-- ============================================================================

set lock_timeout = '5s';
set statement_timeout = '30s';

-- Preserva os registros existentes e converte URLs públicas históricas para o
-- caminho entendido pela Storage API.
alter table public.quote_request_photos rename column url to storage_path;

update public.quote_request_photos
   set storage_path = split_part(storage_path, '/object/public/orcamentos/', 2)
 where storage_path like '%/object/public/orcamentos/%';

comment on column public.quote_request_photos.storage_path is
  'Caminho interno no bucket privado orcamentos; nunca uma URL pública ou assinada.';

drop policy if exists "qrp_cliente_write" on public.quote_request_photos;
drop policy if exists "qrp_cliente_insert" on public.quote_request_photos;
create policy "qrp_cliente_insert" on public.quote_request_photos
  for insert to authenticated
  with check (
    (select public.dono_do_pedido(quote_request_id))
    and storage_path like (select auth.uid())::text || '/%'
  );

drop policy if exists "qrp_cliente_delete" on public.quote_request_photos;
create policy "qrp_cliente_delete" on public.quote_request_photos
  for delete to authenticated
  using ((select public.dono_do_pedido(quote_request_id)));

-- Não existe policy de UPDATE: o vínculo entre pedido e objeto é imutável.

update storage.buckets
   set public = false
 where id = 'orcamentos';

drop policy if exists "orcamentos_public_read" on storage.objects;

create or replace function public.pode_ler_foto_orcamento(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.quote_request_photos f
      join public.quote_requests q on q.id = f.quote_request_id
     where f.storage_path = p_storage_path
       and (
         q.cliente_id = (select auth.uid())
         or exists (
           select 1 from public.quote_request_targets t
            where t.quote_request_id = q.id
              and t.professional_id = (select auth.uid())
         )
         or (select public.eh_admin())
       )
  );
$$;

revoke all on function public.pode_ler_foto_orcamento(text)
  from public, anon;
grant execute on function public.pode_ler_foto_orcamento(text)
  to authenticated;

drop policy if exists "orcamentos_participante_read" on storage.objects;
create policy "orcamentos_participante_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'orcamentos'
    and (select public.pode_ler_foto_orcamento(name))
  );

-- Cria pedido, destinatários e vínculos das fotos em uma transação. Isso evita
-- pedidos sem destinatário quando uma das gravações intermediárias falha.
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

  select coalesce(array_agg(x order by x), '{}'::uuid[])
    into v_profissionais
    from (select distinct unnest(coalesce(p_profissionais_ids, '{}'::uuid[])) x) s;

  if cardinality(v_profissionais) not between 1 and 5 then
    raise exception 'Escolha entre um e cinco profissionais.';
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
    btrim(p_cep),
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
) is 'Cria RFQ, até cinco destinatários e até seis fotos privadas atomicamente.';
