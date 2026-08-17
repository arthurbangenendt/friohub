-- ============================================================================
-- ORÇAMENTO FINAL PÓS-VISITA TÉCNICA
--
-- Problema: quando a proposta aceita é do tipo 'visita_tecnica', `aceitar_quote`
-- grava em `orders.preco_servico` só o `valor_visita` (ver comentário "Visita
-- técnica cobra a visita agora; o serviço é orçado depois dela." em
-- 20260812240000_orcamentos.sql, nunca resolvido até aqui). Depois que o
-- profissional visita o local e sabe o preço real do serviço, não havia
-- schema, função nem tela para ele informar esse valor — e `orders_job_unique`
-- (unique em job_id) impediria uma segunda order mesmo que existisse UI.
--
-- Modelo adotado:
--
--   1. `job_final_quotes` é o orçamento do SERVIÇO, lançado pelo profissional
--      depois da visita. Uma linha por tentativa de envio (append, não update) —
--      mesmo racional de `protege_quote`: "proposta já respondida não se
--      reescreve". Recusa não apaga nem reescreve; gera espaço para reenvio.
--
--   2. O valor da visita NÃO é abatido do valor do serviço: é receita própria e
--      já liquidada do profissional, separada da receita do serviço. Por isso
--      o orçamento final gera uma SEGUNDA `order` (origem='orcamento_final'),
--      em vez de um UPDATE na order original — mesmo padrão de relaxamento já
--      usado no projeto (`purchase_orders_order_id_key` →
--      `unique(order_id, distributor_id)`, ver 20260817122000).
--
--   3. Ciclo do job passa a ter um estado novo entre as duas metades do
--      trabalho: `em_execucao (visita) -> aguardando_orcamento_final ->
--      em_execucao (execução real) -> concluido`. As duas transições novas só
--      acontecem dentro das funções SECURITY DEFINER abaixo — igual a `orders`
--      nunca nascer de um INSERT direto do cliente, `protege_job_transicao`
--      não precisa mudar: `current_user` dentro de função DEFINER já não é
--      'authenticated'/'anon', então a trava nem entra em ação (mesmo caminho
--      que `criar_order`, `aceitar_quote` e `marca_job_avaliado` já usam).
--
--   4. Comissão da plataforma incide sobre o valor do serviço exatamente como
--      incide hoje sobre o valor da visita: mesma fonte, `platform_config
--      .comissao_servico_pct`, sem tratamento especial.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. `jobs.status` ganha o estado intermediário
-- ---------------------------------------------------------------------------
do $$
declare
  v_conname text;
begin
  select conname into v_conname
    from pg_constraint
   where conrelid = 'public.jobs'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%aguardando_profissional%';

  if v_conname is not null then
    execute format('alter table public.jobs drop constraint %I', v_conname);
  end if;
end $$;

alter table public.jobs add constraint jobs_status_check
  check (status in ('aberto', 'aguardando_profissional', 'aceito',
                     'em_execucao', 'aguardando_orcamento_final',
                     'concluido', 'avaliado', 'cancelado'));

-- ---------------------------------------------------------------------------
-- 2. Orçamento do serviço, lançado pelo profissional após a visita
-- ---------------------------------------------------------------------------
create table public.job_final_quotes (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs (id) on delete cascade,

  valor_servico   numeric(10,2) not null check (valor_servico > 0),
  observacoes     text,

  status          text not null default 'enviado'
                  check (status in ('enviado', 'aprovado', 'recusado')),
  motivo_recusa   text,

  enviado_por     uuid not null references public.profiles (id),
  respondido_em   timestamptz,

  created_at      timestamptz not null default now()
);

create index idx_jfq_job on public.job_final_quotes (job_id, created_at desc);

-- Nunca mais de um orçamento final em aberto por job ao mesmo tempo — é o que
-- torna "recusar e reenviar" seguro sem lock de aplicação.
create unique index uq_jfq_pendente
  on public.job_final_quotes (job_id)
  where status = 'enviado';

comment on table public.job_final_quotes is
  'Orçamento do serviço lançado pelo profissional após a visita técnica. Uma linha por tentativa de envio — recusa não apaga nem sobrescreve, gera nova linha no reenvio.';

alter table public.job_final_quotes enable row level security;

-- Mesma visibilidade do job: cliente dono, profissional contratado, admin.
create policy "jfq_read" on public.job_final_quotes for select
  using (
    exists (
      select 1 from public.jobs j
       where j.id = job_final_quotes.job_id
         and (
           j.cliente_id = (select auth.uid())
           or j.profissional_id = (select auth.uid())
         )
    )
    or public.eh_admin()
  );

-- Escrita é exclusiva das funções abaixo (SECURITY DEFINER, bypassam RLS).
-- Nenhuma policy de insert/update/delete: aprovar/recusar direto pela API
-- deixaria o próprio profissional aprovar o preço que ele mesmo propôs.
grant select on public.job_final_quotes to authenticated;
revoke insert, update, delete on public.job_final_quotes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. `orders` passa a admitir uma segunda linha por job: a do serviço
-- ---------------------------------------------------------------------------
alter table public.orders
  add column origem text not null default 'aceite_quote'
    check (origem in ('aceite_quote', 'orcamento_final')),
  add column job_final_quote_id uuid references public.job_final_quotes (id);

alter table public.orders drop constraint if exists orders_job_unique;
alter table public.orders add constraint orders_job_origem_unique unique (job_id, origem);

comment on column public.orders.origem is
  'aceite_quote: nasce em aceitar_quote (produto + mão de obra/visita). orcamento_final: nasce em aprovar_orcamento_final (valor do serviço pós-visita). Um job pode ter até uma order de cada origem.';

-- ---------------------------------------------------------------------------
-- 4. Profissional envia (ou reenvia) o orçamento do serviço
-- ---------------------------------------------------------------------------
create or replace function public.enviar_orcamento_final(
  p_job_id uuid,
  p_valor_servico numeric,
  p_observacoes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs%rowtype;
  v_id  uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Não autenticado.';
  end if;
  if coalesce(p_valor_servico, 0) <= 0 then
    raise exception 'Informe um valor de serviço válido.';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'Serviço não encontrado.';
  end if;
  if v_job.profissional_id is distinct from (select auth.uid()) then
    raise exception 'Apenas o profissional responsável pode enviar o orçamento final.';
  end if;
  if v_job.status not in ('em_execucao', 'aguardando_orcamento_final') then
    raise exception 'Este serviço não está na etapa de orçamento final.';
  end if;

  -- Orçamento final só existe porque a proposta aceita foi 'visita_tecnica' —
  -- em preço fechado o valor do serviço já está definido desde o aceite.
  if not exists (
    select 1 from public.quotes q
     where q.job_id = p_job_id and q.status = 'aceita' and q.tipo = 'visita_tecnica'
  ) then
    raise exception 'Orçamento final só se aplica a serviços contratados como visita técnica.';
  end if;

  if exists (
    select 1 from public.job_final_quotes
     where job_id = p_job_id and status = 'enviado'
  ) then
    raise exception 'Já existe um orçamento final aguardando resposta do cliente.';
  end if;

  insert into public.job_final_quotes (job_id, valor_servico, observacoes, enviado_por)
  values (p_job_id, round(p_valor_servico, 2), nullif(btrim(coalesce(p_observacoes, '')), ''), auth.uid())
  returning id into v_id;

  -- Só muda o job na primeira vez: no reenvio pós-recusa ele já está aqui.
  update public.jobs set status = 'aguardando_orcamento_final'
   where id = p_job_id and status = 'em_execucao';

  return v_id;
end;
$$;

revoke all on function public.enviar_orcamento_final(uuid, numeric, text) from public, anon;
grant execute on function public.enviar_orcamento_final(uuid, numeric, text) to authenticated;

comment on function public.enviar_orcamento_final is
  'Profissional lança (ou relança, após recusa) o valor do serviço pós-visita. Move o job para aguardando_orcamento_final.';

-- ---------------------------------------------------------------------------
-- 5. Cliente aprova: nasce a segunda order, comissão calculada no banco
-- ---------------------------------------------------------------------------
create or replace function public.aprovar_orcamento_final(p_job_final_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jfq      public.job_final_quotes%rowtype;
  v_job      public.jobs%rowtype;
  v_pct      numeric;
  v_order_id uuid;
begin
  select * into v_jfq from public.job_final_quotes where id = p_job_final_quote_id for update;
  if not found then
    raise exception 'Orçamento final não encontrado.';
  end if;

  select * into v_job from public.jobs where id = v_jfq.job_id for update;

  -- Replica protege_quote/aceitar_quote: só o cliente dono aprova, nunca o
  -- profissional que propôs o próprio preço.
  if v_job.cliente_id is distinct from (select auth.uid()) then
    raise exception 'Apenas o cliente do serviço pode aprovar o orçamento final.';
  end if;
  if v_jfq.status <> 'enviado' then
    raise exception 'Este orçamento final já foi respondido.';
  end if;
  if v_job.status <> 'aguardando_orcamento_final' then
    raise exception 'Este serviço não está aguardando orçamento final.';
  end if;

  select comissao_servico_pct into v_pct from public.platform_config where id;

  insert into public.orders (
    job_id, preco_produto, preco_servico, comissao_servico,
    margem_produto, total, payment_status, origem, job_final_quote_id
  ) values (
    v_job.id,
    0,
    v_jfq.valor_servico,
    round(v_jfq.valor_servico * coalesce(v_pct, 0.04), 2),
    0,
    v_jfq.valor_servico,
    'pendente',
    'orcamento_final',
    v_jfq.id
  )
  returning id into v_order_id;

  update public.job_final_quotes
     set status = 'aprovado', respondido_em = now()
   where id = v_jfq.id;

  update public.jobs set status = 'em_execucao' where id = v_job.id;

  return v_order_id;
end;
$$;

revoke all on function public.aprovar_orcamento_final(uuid) from public, anon;
grant execute on function public.aprovar_orcamento_final(uuid) to authenticated;

comment on function public.aprovar_orcamento_final is
  'Cliente aprova o orçamento final: cria a order do serviço (origem=orcamento_final) com comissão da plataforma, e o job volta a em_execucao para a execução real.';

-- ---------------------------------------------------------------------------
-- 6. Cliente recusa: fica aberto para o profissional reenviar outro valor
-- ---------------------------------------------------------------------------
create or replace function public.recusar_orcamento_final(
  p_job_final_quote_id uuid,
  p_motivo text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jfq public.job_final_quotes%rowtype;
  v_job public.jobs%rowtype;
begin
  select * into v_jfq from public.job_final_quotes where id = p_job_final_quote_id for update;
  if not found then
    raise exception 'Orçamento final não encontrado.';
  end if;

  select * into v_job from public.jobs where id = v_jfq.job_id;
  if v_job.cliente_id is distinct from (select auth.uid()) then
    raise exception 'Apenas o cliente do serviço pode recusar o orçamento final.';
  end if;
  if v_jfq.status <> 'enviado' then
    raise exception 'Este orçamento final já foi respondido.';
  end if;

  update public.job_final_quotes
     set status = 'recusado',
         motivo_recusa = nullif(btrim(coalesce(p_motivo, '')), ''),
         respondido_em = now()
   where id = v_jfq.id;

  -- jobs.status permanece 'aguardando_orcamento_final': o profissional pode
  -- chamar enviar_orcamento_final de novo a partir daqui, sem cancelar o job.
end;
$$;

revoke all on function public.recusar_orcamento_final(uuid, text) from public, anon;
grant execute on function public.recusar_orcamento_final(uuid, text) to authenticated;

comment on function public.recusar_orcamento_final is
  'Cliente recusa o orçamento final. O job continua aguardando_orcamento_final, liberado para o profissional reenviar outro valor.';
