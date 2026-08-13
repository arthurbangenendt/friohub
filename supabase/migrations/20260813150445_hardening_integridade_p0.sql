-- ============================================================================
-- HARDENING DE INTEGRIDADE — P0.1 a P0.4
--
-- Esta migration não altera dados existentes em massa e não remove colunas.
-- Fecha superfícies de escrita genérica na Data API e torna decisões exclusivas
-- idempotentes/serializadas no banco.
--
-- Storage privado fica em migration separada: exige adaptar leitura e tratar as
-- URLs públicas históricas antes de mudar o bucket.
-- ============================================================================

set lock_timeout = '5s';
set statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 1. Uma identidade só cria a entidade correspondente ao próprio papel
-- ---------------------------------------------------------------------------
create or replace function public.valida_papel_entidade()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_esperado text;
  v_papel    text;
begin
  if current_user not in ('authenticated', 'anon') or public.eh_admin() then
    return new;
  end if;

  v_esperado := case tg_table_name
    when 'professionals' then 'profissional'
    when 'distributors'  then 'distribuidora'
    else null
  end;

  if v_esperado is null then
    raise exception 'Entidade não suportada por valida_papel_entidade().';
  end if;
  if (select auth.uid()) is null or new.id is distinct from (select auth.uid()) then
    raise exception 'A entidade precisa pertencer ao usuário autenticado.';
  end if;

  select p.role into v_papel from public.profiles p where p.id = (select auth.uid());
  if v_papel is distinct from v_esperado then
    raise exception 'Seu papel não permite criar ou editar esta entidade.';
  end if;

  return new;
end;
$$;

revoke all on function public.valida_papel_entidade() from public, anon, authenticated;

drop trigger if exists trg_00_professionals_valida_papel on public.professionals;
create trigger trg_00_professionals_valida_papel
  before insert or update on public.professionals
  for each row execute function public.valida_papel_entidade();

drop trigger if exists trg_00_distributors_valida_papel on public.distributors;
create trigger trg_00_distributors_valida_papel
  before insert or update on public.distributors
  for each row execute function public.valida_papel_entidade();

-- ---------------------------------------------------------------------------
-- 2. Produto: proteção e markup em UM trigger
--
-- Antes havia dois BEFORE triggers cuja ordem alfabética permitia enviar
-- preco_manual=true e preco_venda arbitrário. O trigger único elimina estado
-- intermediário inseguro.
-- ---------------------------------------------------------------------------
create or replace function public.protege_produto()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_markup numeric;
  v_admin  boolean := public.eh_admin();
  v_uid    uuid := (select auth.uid());
begin
  select pc.markup_produto_pct
    into v_markup
    from public.platform_config pc
   where pc.id;

  v_markup := coalesce(v_markup, 0.25);

  if current_user in ('authenticated', 'anon') and not v_admin then
    if v_uid is null or not exists (
      select 1 from public.profiles p
       where p.id = v_uid and p.role = 'distribuidora'
    ) then
      raise exception 'Apenas distribuidoras podem manter produtos.';
    end if;

    if tg_op = 'INSERT' then
      new.distributor_id := v_uid;
      new.preco_manual   := false;
      new.preco_venda    := round(new.custo * (1 + v_markup), 2);
    else
      new.distributor_id := old.distributor_id;
      if old.preco_manual then
        new.preco_manual := true;
        new.preco_venda  := old.preco_venda;
      else
        new.preco_manual := false;
        new.preco_venda  := round(new.custo * (1 + v_markup), 2);
      end if;
    end if;
  elsif new.preco_manual then
    if new.preco_venda <= 0 then
      raise exception 'Preço manual precisa ser maior que zero.';
    end if;
  else
    new.preco_venda := round(new.custo * (1 + v_markup), 2);
  end if;

  if new.custo <= 0 then
    raise exception 'Custo do produto precisa ser maior que zero.';
  end if;
  if new.btu <= 0 then
    raise exception 'Capacidade do produto precisa ser maior que zero.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_products_markup on public.products;
drop trigger if exists trg_products_protege on public.products;
create trigger trg_products_protege
  before insert or update on public.products
  for each row execute function public.protege_produto();

-- A distribuidora não precisa mais enviar um preço fictício no INSERT; o BEFORE
-- trigger sempre grava o valor derivado antes da validação NOT NULL.
alter table public.products alter column preco_venda set default 0;

-- ---------------------------------------------------------------------------
-- 3. Pedido de orçamento: escopo congelado e cancelamento explícito
-- ---------------------------------------------------------------------------
create or replace function public.protege_quote_request()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if current_user not in ('authenticated', 'anon') or public.eh_admin() then
    return new;
  end if;

  new.id               := old.id;
  new.cliente_id       := old.cliente_id;
  new.job_type         := old.job_type;
  new.cep              := old.cep;
  new.cidade           := old.cidade;
  new.bairro           := old.bairro;
  new.quantidade       := old.quantidade;
  new.urgencia         := old.urgencia;
  new.descricao        := old.descricao;
  new.produto_id       := old.produto_id;
  new.btu_recomendado  := old.btu_recomendado;
  new.expira_em        := old.expira_em;
  new.created_at       := old.created_at;

  -- Complementos técnicos entram atomicamente pela RPC de aceite. A Data API
  -- não altera o escopo depois que o pedido foi distribuído.
  new.detalhes := old.detalhes;

  if new.status is distinct from old.status then
    if not (
      v_uid = old.cliente_id
      and old.status = 'aberto'
      and new.status = 'cancelado'
    ) then
      new.status := old.status;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_quote_requests_protege on public.quote_requests;
create trigger trg_quote_requests_protege
  before update on public.quote_requests
  for each row execute function public.protege_quote_request();

drop policy if exists "qr_cliente_all" on public.quote_requests;
drop policy if exists "qr_cliente_select" on public.quote_requests;
create policy "qr_cliente_select" on public.quote_requests
  for select to authenticated
  using ((select auth.uid()) = cliente_id);

drop policy if exists "qr_cliente_insert" on public.quote_requests;
create policy "qr_cliente_insert" on public.quote_requests
  for insert to authenticated
  with check ((select auth.uid()) = cliente_id and status = 'aberto');

drop policy if exists "qr_cliente_update" on public.quote_requests;
create policy "qr_cliente_update" on public.quote_requests
  for update to authenticated
  using ((select auth.uid()) = cliente_id)
  with check ((select auth.uid()) = cliente_id);

-- ---------------------------------------------------------------------------
-- 4. Destinatários: máximo de cinco e chaves imutáveis
-- ---------------------------------------------------------------------------
create or replace function public.valida_quote_target_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  -- Em trigger SECURITY DEFINER, current_user é o dono da função. auth.uid()
  -- preserva a identidade JWT da requisição; operações internas confiáveis não
  -- carregam JWT e continuam autorizadas a popular a tabela.
  if v_uid is null then
    return new;
  end if;

  -- Serializa inserts para o mesmo pedido, inclusive em requisições paralelas.
  perform pg_advisory_xact_lock(hashtextextended(new.quote_request_id::text, 0));

  if not exists (
    select 1 from public.quote_requests q
     where q.id = new.quote_request_id
       and q.cliente_id = v_uid
       and q.status = 'aberto'
       and q.expira_em > now()
  ) then
    raise exception 'Pedido inexistente, encerrado ou sem permissão.';
  end if;

  if not exists (
    select 1
      from public.professionals pr
      join public.profiles p on p.id = pr.id
     where pr.id = new.professional_id
       and p.role = 'profissional'
  ) then
    raise exception 'Destinatário não é um profissional válido.';
  end if;

  if (select count(*) from public.quote_request_targets t
       where t.quote_request_id = new.quote_request_id) >= 5 then
    raise exception 'Cada pedido pode ter no máximo cinco profissionais.';
  end if;

  return new;
end;
$$;

revoke all on function public.valida_quote_target_insert() from public, anon, authenticated;

drop trigger if exists trg_quote_targets_valida_insert on public.quote_request_targets;
create trigger trg_quote_targets_valida_insert
  before insert on public.quote_request_targets
  for each row execute function public.valida_quote_target_insert();

create or replace function public.protege_quote_target_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.eh_admin() then
    return new;
  end if;

  new.quote_request_id := old.quote_request_id;
  new.professional_id  := old.professional_id;
  new.enviado_em       := old.enviado_em;

  if (select auth.uid()) is distinct from old.professional_id then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_quote_targets_protege_update on public.quote_request_targets;
create trigger trg_quote_targets_protege_update
  before update on public.quote_request_targets
  for each row execute function public.protege_quote_target_update();

drop policy if exists "qrt_cliente_all" on public.quote_request_targets;
drop policy if exists "qrt_cliente_select" on public.quote_request_targets;
create policy "qrt_cliente_select" on public.quote_request_targets
  for select to authenticated
  using ((select public.dono_do_pedido(quote_request_id)));

drop policy if exists "qrt_cliente_insert" on public.quote_request_targets;
create policy "qrt_cliente_insert" on public.quote_request_targets
  for insert to authenticated
  with check ((select public.dono_do_pedido(quote_request_id)));

-- ---------------------------------------------------------------------------
-- 5. Conversa: participantes e vínculo não são editáveis pela Data API
--
-- last_message_at continua sendo atualizado por touch_conversa(), que é definer.
-- ---------------------------------------------------------------------------
drop policy if exists "conversas_participante_update" on public.conversations;

-- ---------------------------------------------------------------------------
-- 6. Repasse: identidade/valor congelados; transição somente por RPC
-- ---------------------------------------------------------------------------
drop policy if exists "po_dist_update" on public.purchase_orders;

create table if not exists public.purchase_order_events (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  actor_id          uuid references public.profiles (id) on delete set null,
  status_anterior   text not null,
  status_novo       text not null,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists idx_po_events_order_created
  on public.purchase_order_events (purchase_order_id, created_at desc);

alter table public.purchase_order_events enable row level security;

drop policy if exists "po_events_read" on public.purchase_order_events;
create policy "po_events_read" on public.purchase_order_events
  for select to authenticated
  using (
    exists (
      select 1 from public.purchase_orders po
       where po.id = purchase_order_id
         and (po.distributor_id = (select auth.uid()) or (select public.eh_admin()))
    )
  );

grant select on public.purchase_order_events to authenticated;
revoke insert, update, delete on public.purchase_order_events from anon, authenticated;

create or replace function public.avancar_purchase_order(
  p_purchase_order_id uuid,
  p_status text,
  p_codigo_rastreio text default null,
  p_nota_fiscal_url text default null
)
returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_po        public.purchase_orders%rowtype;
  v_resultado public.purchase_orders%rowtype;
  v_ok        boolean := false;
  v_rastreio  text;
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;

  select * into v_po
    from public.purchase_orders
   where id = p_purchase_order_id
   for update;

  if not found then
    raise exception 'Pedido de repasse não encontrado.';
  end if;
  if v_po.distributor_id is distinct from v_uid and not public.eh_admin() then
    raise exception 'Você não pode movimentar este repasse.';
  end if;

  v_ok := case v_po.status
    when 'a_repassar' then p_status in ('confirmado', 'cancelado')
    when 'confirmado' then p_status in ('faturado', 'cancelado')
    when 'faturado'   then p_status in ('enviado', 'cancelado')
    when 'enviado'    then p_status = 'entregue'
    else false
  end;

  if not v_ok then
    raise exception 'Transição de repasse inválida: % → %.', v_po.status, p_status;
  end if;

  v_rastreio := coalesce(nullif(btrim(p_codigo_rastreio), ''), v_po.codigo_rastreio);
  if p_status = 'enviado' and v_rastreio is null then
    raise exception 'Informe o código de rastreio antes de marcar como enviado.';
  end if;

  update public.purchase_orders
     set status = p_status,
         codigo_rastreio = v_rastreio,
         nota_fiscal_url = coalesce(
           nullif(btrim(p_nota_fiscal_url), ''),
           v_po.nota_fiscal_url
         )
   where id = v_po.id
  returning * into v_resultado;

  insert into public.purchase_order_events (
    purchase_order_id, actor_id, status_anterior, status_novo, metadata
  ) values (
    v_po.id,
    v_uid,
    v_po.status,
    p_status,
    jsonb_strip_nulls(jsonb_build_object(
      'codigo_rastreio', v_rastreio,
      'nota_fiscal_url', nullif(btrim(p_nota_fiscal_url), '')
    ))
  );

  return v_resultado;
end;
$$;

revoke all on function public.avancar_purchase_order(uuid, text, text, text)
  from public, anon;
grant execute on function public.avancar_purchase_order(uuid, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Aceite serializado e idempotente
-- ---------------------------------------------------------------------------
alter table public.jobs add column if not exists quote_request_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'jobs_quote_request_id_fkey'
       and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_quote_request_id_fkey
      foreign key (quote_request_id)
      references public.quote_requests (id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'jobs_quote_request_id_key'
       and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_quote_request_id_key unique (quote_request_id);
  end if;
end $$;

drop function if exists public.aceitar_quote(uuid, text);
create function public.aceitar_quote(
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
  v_dist        uuid;
  v_prazo       int := 5;
  v_job_id      uuid;
  v_order_id    uuid;
  v_request_id  uuid;
  v_detalhes    jsonb;
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

  -- Descobre o agregado e adquire sempre o lock do pedido antes do lock da
  -- proposta. Chamadas concorrentes para propostas diferentes serializam aqui.
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

  if v_req.produto_id is not null then
    select p.preco_venda, p.custo, p.distributor_id, d.prazo_entrega_dias
      into v_venda, v_custo, v_dist, v_prazo
      from public.products p
      join public.distributors d on d.id = p.distributor_id
     where p.id = v_req.produto_id
       and p.ativo
       and p.estoque_disponivel
       and d.ativo
       and d.verification_status = 'verificado'
     for share of p, d;

    if not found then
      raise exception 'O equipamento escolhido não está mais disponível.';
    end if;
  end if;

  insert into public.jobs (
    quote_request_id,
    cliente_id, job_type, has_equipment, cep, endereco, cidade, descricao,
    produto_id, btu_recomendado, area_m2, ambiente, num_pessoas,
    insolacao_alta, andar_ou_telhado,
    profissional_id, status
  ) values (
    v_req.id,
    v_req.cliente_id, v_req.job_type, v_req.produto_id is not null, v_req.cep,
    btrim(p_endereco), v_req.cidade, v_req.descricao,
    v_req.produto_id, v_req.btu_recomendado,
    nullif(v_detalhes->>'area_m2', '')::numeric,
    nullif(v_detalhes->>'ambiente', ''),
    nullif(v_detalhes->>'num_pessoas', '')::int,
    nullif(v_detalhes->>'insolacao_alta', '')::boolean,
    nullif(v_detalhes->>'andar_ou_telhado', '')::boolean,
    v_quote.professional_id, 'aguardando_profissional'
  )
  returning id into v_job_id;

  select pc.comissao_servico_pct into v_pct
    from public.platform_config pc
   where pc.id;

  insert into public.orders (
    job_id, preco_produto, preco_servico, comissao_servico, margem_produto, total, payment_status
  ) values (
    v_job_id,
    coalesce(v_venda, 0),
    v_servico,
    round(v_servico * coalesce(v_pct, 0.15), 2),
    coalesce(v_venda, 0) - coalesce(v_custo, 0),
    coalesce(v_venda, 0) + v_servico,
    'pendente'
  )
  returning id into v_order_id;

  if v_dist is not null then
    insert into public.purchase_orders (
      order_id, distributor_id, custo_snapshot, prazo_previsto
    ) values (
      v_order_id,
      v_dist,
      coalesce(v_custo, 0),
      current_date + coalesce(v_prazo, 5)
    );
  end if;

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

revoke all on function public.aceitar_quote(uuid, text, jsonb) from public, anon;
grant execute on function public.aceitar_quote(uuid, text, jsonb) to authenticated;

comment on function public.aceitar_quote(uuid, text, jsonb) is
  'Aceite serializado por quote_request. Cria no máximo um job/order/repasse e valida disponibilidade do produto no momento da decisão.';
