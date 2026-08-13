-- ============================================================================
-- ORÇAMENTOS (RFQ) — o caminho padrão para serviço sem equipamento
--
-- Problema que isto resolve: `orders` só nascia quando havia produto escolhido
-- (`solicitar/actions.ts`, dentro do `if (hasEquipment)`). Manutenção, limpeza,
-- conserto e remanejamento — 4 dos 7 tipos, e justamente os de repetição —
-- saíam sem preço nenhum, e a comissão de 15% da plataforma nunca existia.
--
-- Como orçamento de climatização funciona de fato, e por que o modelo é este:
--
--   · O que move o preço não é o BTU. É metragem de linha frigorígena, tipo de
--     parede, acesso (altura, andaime, NR-35), infra elétrica existente, caminho
--     do dreno, e regra de condomínio. Cada tipo de serviço pergunta coisas
--     diferentes — daí `detalhes jsonb` em vez de dezenas de colunas: o
--     questionário evolui sem migration. O catálogo de perguntas vive no app,
--     em `solicitar/perguntas-orcamento.ts`.
--   · Foto é decisiva (ambiente, aparelho, plaqueta, quadro elétrico).
--   · Muitas vezes não dá para fechar preço sem ver. Por isso a proposta tem
--     dois formatos: preço fechado ou visita técnica.
--   · A proposta séria diz o que ESTÁ e o que NÃO está incluso — é onde nasce
--     toda disputa —, além de prazo, garantia e validade (cobre e gás oscilam).
--
-- O endereço completo NÃO entra no pedido de orçamento, de propósito: para
-- precificar basta o CEP. A rua e o número só são informados quando o cliente
-- aceita uma proposta, e aí vão direto para o job — que já é visível só ao
-- profissional contratado.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Pedido de orçamento
-- ---------------------------------------------------------------------------
create table if not exists public.quote_requests (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references public.profiles (id) on delete cascade,

  job_type     text not null
               check (job_type in ('instalacao_com_equipamento', 'troca_equipamento', 'manutencao',
                                   'remanejamento', 'limpeza', 'conserto', 'outros')),
  cep          text not null,
  cidade       text not null,
  bairro       text,

  quantidade   int  not null default 1 check (quantidade between 1 and 100),
  urgencia     text check (urgencia in ('sem_pressa', 'proximos_dias', 'urgente')),
  descricao    text,

  /* Instalação também passa por orçamento — é onde a variação é maior (metragem
     de linha frigorígena, parede, altura, elétrica). O que muda é a divisão: o
     APARELHO tem preço de catálogo e margem nossa; o profissional orça só a MÃO
     DE OBRA. Por isso o produto escolhido viaja junto com o pedido.
     Nulo = serviço sem equipamento, ou cliente que já tem o aparelho. */
  produto_id       uuid references public.products (id),
  btu_recomendado  int,

  -- Respostas do questionário técnico do tipo de serviço. Chaves definidas em
  -- `perguntas-orcamento.ts`; validadas no app, não no banco, porque o conjunto
  -- muda com frequência e um CHECK aqui viraria migration a cada ajuste.
  detalhes     jsonb not null default '{}'::jsonb,

  status       text not null default 'aberto'
               check (status in ('aberto', 'fechado', 'cancelado', 'expirado')),
  expira_em    timestamptz not null default (now() + interval '7 days'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_qr_cliente on public.quote_requests (cliente_id, created_at desc);

create trigger trg_quote_requests_touch before update on public.quote_requests
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Para quem o pedido foi enviado (multi-cotação)
--
--    O cliente descreve uma vez e dispara para vários profissionais. É o padrão
--    do mercado e o que resolve o cold start: quem não responde, perde. O limite
--    de destinatários é imposto no app — aqui o que importa é o vínculo.
-- ---------------------------------------------------------------------------
create table if not exists public.quote_request_targets (
  quote_request_id uuid not null references public.quote_requests (id) on delete cascade,
  professional_id  uuid not null references public.professionals (id) on delete cascade,
  enviado_em       timestamptz not null default now(),
  visto_em         timestamptz,
  recusado_em      timestamptz,
  motivo_recusa    text,
  primary key (quote_request_id, professional_id)
);

create index if not exists idx_qrt_pro on public.quote_request_targets (professional_id, enviado_em desc);

-- ---------------------------------------------------------------------------
-- 3. Fotos do pedido
-- ---------------------------------------------------------------------------
create table if not exists public.quote_request_photos (
  id               uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests (id) on delete cascade,
  url              text not null,
  created_at       timestamptz not null default now()
);

create index if not exists idx_qrp_pedido on public.quote_request_photos (quote_request_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('orcamentos', 'orcamentos', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "orcamentos_public_read" on storage.objects;
create policy "orcamentos_public_read" on storage.objects
  for select using (bucket_id = 'orcamentos');

drop policy if exists "orcamentos_owner_insert" on storage.objects;
create policy "orcamentos_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'orcamentos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "orcamentos_owner_delete" on storage.objects;
create policy "orcamentos_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'orcamentos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 4. A proposta do profissional
-- ---------------------------------------------------------------------------
create table if not exists public.quotes (
  id               uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests (id) on delete cascade,
  professional_id  uuid not null references public.professionals (id) on delete cascade,

  -- 'visita_tecnica' existe porque em instalação e conserto o profissional
  -- honesto não fecha preço sem ver. Sem essa opção ele infla o valor para se
  -- proteger, ou simplesmente não responde.
  tipo             text not null default 'preco_fechado'
                   check (tipo in ('preco_fechado', 'visita_tecnica')),

  valor_mao_obra   numeric(10,2) not null default 0 check (valor_mao_obra  >= 0),
  valor_materiais  numeric(10,2) not null default 0 check (valor_materiais >= 0),
  valor_visita     numeric(10,2) not null default 0 check (valor_visita    >= 0),
  visita_abatida   boolean not null default true,   -- visita abate do serviço se fechar

  inclui           text,          -- o que está incluso
  nao_inclui       text,          -- o que NÃO está — onde nasce toda disputa
  prazo_execucao   text,          -- "2 dias úteis", "meio período"
  garantia_dias    int not null default 90 check (garantia_dias >= 0),
  validade_ate     date not null default (current_date + 7),
  observacoes      text,

  status           text not null default 'enviada'
                   check (status in ('enviada', 'aceita', 'recusada', 'expirada', 'retirada')),
  job_id           uuid references public.jobs (id) on delete set null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (quote_request_id, professional_id),

  -- Proposta de preço fechado sem valor nenhum não é proposta.
  constraint quotes_valor_coerente check (
    (tipo = 'preco_fechado' and valor_mao_obra + valor_materiais > 0)
    or (tipo = 'visita_tecnica')
  )
);

create index if not exists idx_quotes_pedido on public.quotes (quote_request_id);
create index if not exists idx_quotes_pro    on public.quotes (professional_id, created_at desc);

create trigger trg_quotes_touch before update on public.quotes
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5. RLS
--
--    Regra central: um profissional NUNCA vê a proposta de outro. Se visse,
--    cobriria o concorrente por centavos e o leilão viraria corrida ao fundo —
--    que é o que destrói a qualidade numa rede de serviço técnico.
-- ---------------------------------------------------------------------------
alter table public.quote_requests        enable row level security;
alter table public.quote_request_targets enable row level security;
alter table public.quote_request_photos  enable row level security;
alter table public.quotes                enable row level security;

-- Pedido: o cliente é dono; o profissional lê apenas o que foi enviado a ele.
drop policy if exists "qr_cliente_all" on public.quote_requests;
create policy "qr_cliente_all" on public.quote_requests for all
  using (cliente_id = auth.uid())
  with check (cliente_id = auth.uid());

drop policy if exists "qr_target_read" on public.quote_requests;
create policy "qr_target_read" on public.quote_requests for select
  using (
    exists (
      select 1 from public.quote_request_targets t
       where t.quote_request_id = quote_requests.id
         and t.professional_id = auth.uid()
    )
    or public.eh_admin()
  );

-- Destinatários: o cliente monta a lista; cada profissional enxerga só a
-- própria linha (não descobre com quem está concorrendo).
drop policy if exists "qrt_cliente_all" on public.quote_request_targets;
create policy "qrt_cliente_all" on public.quote_request_targets for all
  using (
    exists (select 1 from public.quote_requests q
             where q.id = quote_request_targets.quote_request_id and q.cliente_id = auth.uid())
  )
  with check (
    exists (select 1 from public.quote_requests q
             where q.id = quote_request_targets.quote_request_id and q.cliente_id = auth.uid())
  );

drop policy if exists "qrt_pro_read" on public.quote_request_targets;
create policy "qrt_pro_read" on public.quote_request_targets for select
  using (professional_id = auth.uid());

-- Marcar como visto / recusar é do próprio profissional.
drop policy if exists "qrt_pro_update" on public.quote_request_targets;
create policy "qrt_pro_update" on public.quote_request_targets for update
  using (professional_id = auth.uid())
  with check (professional_id = auth.uid());

-- Fotos acompanham a visibilidade do pedido.
drop policy if exists "qrp_read" on public.quote_request_photos;
create policy "qrp_read" on public.quote_request_photos for select
  using (
    exists (
      select 1 from public.quote_requests q
       where q.id = quote_request_photos.quote_request_id
         and (
           q.cliente_id = auth.uid()
           or exists (select 1 from public.quote_request_targets t
                       where t.quote_request_id = q.id and t.professional_id = auth.uid())
         )
    )
  );

drop policy if exists "qrp_cliente_write" on public.quote_request_photos;
create policy "qrp_cliente_write" on public.quote_request_photos for all
  using (
    exists (select 1 from public.quote_requests q
             where q.id = quote_request_photos.quote_request_id and q.cliente_id = auth.uid())
  )
  with check (
    exists (select 1 from public.quote_requests q
             where q.id = quote_request_photos.quote_request_id and q.cliente_id = auth.uid())
  );

-- Proposta: o autor vê e escreve a sua; o cliente do pedido vê todas as que
-- recebeu. Nenhum outro profissional enxerga nada.
drop policy if exists "quotes_pro_read" on public.quotes;
create policy "quotes_pro_read" on public.quotes for select
  using (professional_id = auth.uid() or public.eh_admin());

drop policy if exists "quotes_cliente_read" on public.quotes;
create policy "quotes_cliente_read" on public.quotes for select
  using (
    exists (select 1 from public.quote_requests q
             where q.id = quotes.quote_request_id and q.cliente_id = auth.uid())
  );

/* Só responde quem foi convidado, e só enquanto o pedido está aberto e no prazo.
   Sem isso, qualquer profissional responderia qualquer pedido — inclusive os que
   não atendem a região. */
drop policy if exists "quotes_pro_insert" on public.quotes;
create policy "quotes_pro_insert" on public.quotes for insert
  with check (
    professional_id = auth.uid()
    and exists (
      select 1
        from public.quote_request_targets t
        join public.quote_requests q on q.id = t.quote_request_id
       where t.quote_request_id = quotes.quote_request_id
         and t.professional_id = auth.uid()
         and q.status = 'aberto'
         and q.expira_em > now()
    )
  );

drop policy if exists "quotes_pro_update" on public.quotes;
create policy "quotes_pro_update" on public.quotes for update
  using (professional_id = auth.uid())
  with check (professional_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 6. Trava: o profissional não muda o próprio status da proposta
--
--    Quem aceita é o cliente, por função (item 7). Sem esta trava, o autor da
--    proposta marcaria a própria como 'aceita' pela API REST e criaria job a
--    partir do nada. Mesmo padrão de preservação silenciosa das outras travas.
-- ---------------------------------------------------------------------------
create or replace function public.protege_quote()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  new.quote_request_id := old.quote_request_id;
  new.professional_id  := old.professional_id;
  new.job_id           := old.job_id;

  -- Retirar a própria proposta é legítimo; promovê-la, não.
  if not (old.status = 'enviada' and new.status = 'retirada') then
    new.status := old.status;
  end if;

  -- Proposta já respondida não se reescreve: o cliente decidiu sobre um texto.
  if old.status <> 'enviada' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_quotes_protege on public.quotes;
create trigger trg_quotes_protege
  before update on public.quotes
  for each row execute function public.protege_quote();

-- ---------------------------------------------------------------------------
-- 7. Aceitar a proposta — é aqui que a receita nº 2 finalmente existe
--
--    Aceitar cria o job JÁ com preço, e a order com a comissão calculada a
--    partir de `platform_config`. Roda como definer porque precisa escrever em
--    tabelas de terceiros (jobs do cliente, quotes dos concorrentes) num único
--    passo atômico; toda a autorização está explícita no corpo.
-- ---------------------------------------------------------------------------
create or replace function public.aceitar_quote(p_quote_id uuid, p_endereco text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote   public.quotes%rowtype;
  v_req     public.quote_requests%rowtype;
  v_pct     numeric;
  v_servico numeric(10,2);
  v_venda   numeric(10,2) := 0;
  v_custo   numeric(10,2) := 0;
  v_job_id  uuid;
begin
  select * into v_quote from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'Proposta não encontrada.';
  end if;

  select * into v_req from public.quote_requests where id = v_quote.quote_request_id;

  if v_req.cliente_id is distinct from auth.uid() then
    raise exception 'Apenas o cliente do pedido pode aceitar a proposta.';
  end if;
  if v_quote.status <> 'enviada' then
    raise exception 'Esta proposta não está mais disponível.';
  end if;
  if v_quote.validade_ate < current_date then
    raise exception 'Esta proposta venceu em %.', to_char(v_quote.validade_ate, 'DD/MM/YYYY');
  end if;
  if v_req.status <> 'aberto' then
    raise exception 'Este pedido de orçamento já foi encerrado.';
  end if;

  -- Visita técnica cobra a visita agora; o serviço é orçado depois dela.
  v_servico := case
    when v_quote.tipo = 'visita_tecnica' then v_quote.valor_visita
    else v_quote.valor_mao_obra + v_quote.valor_materiais
  end;

  -- Preço e custo do aparelho vêm do catálogo, nunca da proposta: o profissional
  -- orça mão de obra; a margem do equipamento é da plataforma.
  if v_req.produto_id is not null then
    select p.preco_venda, p.custo into v_venda, v_custo
      from public.products p where p.id = v_req.produto_id;
  end if;

  /* Os dados do ambiente ficam em `detalhes` (jsonb) porque o questionário varia
     por tipo de serviço; aqui eles voltam para as colunas tipadas de `jobs`.
     Cast tolerante: campo ausente ou vazio vira NULL em vez de derrubar o aceite. */
  insert into public.jobs (
    cliente_id, job_type, has_equipment, cep, endereco, cidade, descricao,
    produto_id, btu_recomendado, area_m2, ambiente, num_pessoas,
    insolacao_alta, andar_ou_telhado,
    profissional_id, status
  ) values (
    v_req.cliente_id, v_req.job_type, v_req.produto_id is not null, v_req.cep,
    nullif(btrim(coalesce(p_endereco, '')), ''), v_req.cidade, v_req.descricao,
    v_req.produto_id, v_req.btu_recomendado,
    nullif(v_req.detalhes->>'area_m2', '')::numeric,
    nullif(v_req.detalhes->>'ambiente', ''),
    nullif(v_req.detalhes->>'num_pessoas', '')::int,
    nullif(v_req.detalhes->>'insolacao_alta', '')::boolean,
    nullif(v_req.detalhes->>'andar_ou_telhado', '')::boolean,
    v_quote.professional_id, 'aguardando_profissional'
  )
  returning id into v_job_id;

  select comissao_servico_pct into v_pct from public.platform_config where id;

  insert into public.orders (
    job_id, preco_produto, preco_servico, comissao_servico, margem_produto, total, payment_status
  ) values (
    v_job_id,
    coalesce(v_venda, 0),
    v_servico,
    round(v_servico * coalesce(v_pct, 0.15), 2),   -- comissão só sobre mão de obra
    coalesce(v_venda, 0) - coalesce(v_custo, 0),   -- margem do equipamento
    coalesce(v_venda, 0) + v_servico,
    'pendente'
  );

  update public.quotes
     set status = 'aceita', job_id = v_job_id
   where id = p_quote_id;

  -- As concorrentes caem juntas: o pedido tem um vencedor só.
  update public.quotes
     set status = 'recusada'
   where quote_request_id = v_req.id
     and id <> p_quote_id
     and status = 'enviada';

  update public.quote_requests set status = 'fechado' where id = v_req.id;

  return v_job_id;
end;
$$;

revoke all on function public.aceitar_quote(uuid, text) from public;
grant execute on function public.aceitar_quote(uuid, text) to authenticated;

comment on function public.aceitar_quote is
  'Aceita uma proposta: cria job + order com comissão, recusa as concorrentes e fecha o pedido. Único caminho — o profissional não promove a própria proposta.';
