-- ============================================================================
-- Fecha o gap de verificação (KYC) no caminho onde dinheiro sai da plataforma
-- ============================================================================
--
-- EXIGIR_VERIFICACAO = true (src/lib/config.ts) já é a política declarada do
-- produto, mas só era aplicada na busca/catálogo (`buscar_profissionais_marketplace`,
-- `p_require_verified`) — nunca no banco, nos dois pontos onde realmente
-- importa: quem pode ser ALVO de um pedido de orçamento, e quem pode RECEBER
-- repasse. Um ID de profissional não verificado passado direto à RPC (fora da
-- tela de busca) hoje passa pelas duas checagens sem barreira nenhuma. Esta
-- migration fecha a aplicação real de uma regra que já era a intenção do
-- produto — não é uma política nova.
--
-- Também fecha o risco de troca de chave PIX silenciosa: `salvar_chave_pix`
-- deixa o profissional trocar o destino do próprio repasse a qualquer
-- momento, sem revalidar identidade e sem avisar o dono da conta. Não dá pra
-- bloquear a troca em si (o profissional pode legitimamente mudar de banco),
-- mas dá pra garantir que ele saiba que aconteceu — mesmo padrão de aviso
-- operacional obrigatório já usado por `purchase_order_created/updated`
-- (20260818110000): entra direto na outbox com `inapp_allowed = true,
-- email_allowed = false, whatsapp_allowed = false` (sem canal de e-mail
-- pronto; sem template aprovado na Meta pra este evento ainda).

-- ---------------------------------------------------------------------------
-- 1. criar_pedido_orcamento — profissional-alvo precisa estar verificado
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

  -- O BTU gravado não vem do cliente: é recalculado aqui a partir dos dados
  -- brutos de cada item, para não poder divergir deles. Ver
  -- calcular_btu_recomendado acima.
  select coalesce(jsonb_agg(
    e.item || jsonb_build_object(
      'btu_recomendado',
      public.calcular_btu_recomendado(
        nullif(e.item->>'area_m2', '')::numeric,
        nullif(e.item->>'num_pessoas', '')::int,
        coalesce(nullif(e.item->>'insolacao_alta', '')::boolean, false),
        coalesce(nullif(e.item->>'andar_ou_telhado', '')::boolean, false),
        nullif(e.item->>'eletronicos', '')::int
      )
    )
    order by e.ordinality
  ), '[]'::jsonb)
    into v_itens
    from jsonb_array_elements(v_itens) with ordinality as e(item, ordinality);

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

  -- Não verificado não pode ser alvo de pedido novo. EXIGIR_VERIFICACAO já era
  -- a política declarada do produto (src/lib/config.ts) e já valia na busca —
  -- faltava valer aqui, para um ID passado direto à RPC não pular a aprovação
  -- de um admin.
  if exists (
    select 1 from unnest(v_profissionais) chosen(professional_id)
    join public.professionals pr on pr.id = chosen.professional_id
    where pr.verification_status <> 'verificado'
  ) then
    raise exception 'Um profissional selecionado ainda não foi verificado.';
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
  'btu_recomendado de cada item é recalculado no banco (calcular_btu_recomendado), não '
  'confia no valor enviado pelo cliente. Valida cobertura, fotos, disponibilidade de cada '
  'aparelho, inadimplência e verificação de cada profissional-alvo antes de gravar.';

-- ---------------------------------------------------------------------------
-- 2. preparar_repasse_profissional — não prepara repasse pra quem não passou
--    pela aprovação de um admin, mesmo que já tenha chave PIX cadastrada.
-- ---------------------------------------------------------------------------
create or replace function public.preparar_repasse_profissional(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job          public.jobs%rowtype;
  v_order_id     uuid;
  v_charge_id    uuid;
  v_allocation   public.payment_allocations%rowtype;
  v_chave        text;
  v_chave_tipo   text;
  v_verificado   boolean;
  v_janela_horas int;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if not found or v_job.status <> 'concluido' then
    return;
  end if;

  select id into v_order_id from public.orders where job_id = p_job_id;
  if v_order_id is null then
    return;
  end if;

  -- Só prepara repasse sobre dinheiro que a plataforma REALMENTE recebeu.
  -- `PAYMENT_CONFIRMED` não conta — só `received` é liquidação de verdade
  -- (ver ADR_001_FUNDACAO_FINANCEIRA.md). Hoje isto nunca é encontrado,
  -- porque nada ainda cria payment_charges na aceitação da proposta.
  select id into v_charge_id
    from public.payment_charges
   where order_id = v_order_id and status = 'received'
   order by created_at desc
   limit 1;
  if v_charge_id is null then
    return;
  end if;

  select * into v_allocation
    from public.payment_allocations
   where charge_id = v_charge_id and allocation_type = 'professional_payable';
  if not found or v_allocation.amount <= 0 then
    return;
  end if;

  -- Leitura direta: security definer contorna o grant restrito de
  -- professionals.chave_pix (que não pode aparecer em nenhuma allowlist
  -- pública — ver 20260819120000_pix_profissional.sql).
  select chave_pix, chave_pix_tipo, (verification_status = 'verificado')
    into v_chave, v_chave_tipo, v_verificado
    from public.professionals
   where id = v_job.profissional_id;

  select coalesce(repasse_janela_contencao_horas, 48) into v_janela_horas
    from public.platform_config where id;

  insert into public.payment_transfers (
    allocation_id, order_id, job_id, beneficiary_id,
    gateway, idempotency_key, external_reference,
    pix_key, pix_key_type, amount, status, scheduled_for,
    last_error, failed_at
  ) values (
    v_allocation.id, v_order_id, p_job_id, v_job.profissional_id,
    'asaas', format('job:%s:transfer', p_job_id), format('job:%s', p_job_id),
    coalesce(v_chave, ''), coalesce(v_chave_tipo, ''), v_allocation.amount,
    case when v_chave is null or not coalesce(v_verificado, false) then 'failed' else 'pending_creation' end,
    now() + make_interval(hours => v_janela_horas),
    case
      when v_chave is null then 'Profissional sem chave PIX cadastrada.'
      when not coalesce(v_verificado, false) then 'Profissional ainda não verificado — repasse bloqueado até aprovação do admin.'
    end,
    case when v_chave is null or not coalesce(v_verificado, false) then now() end
  )
  on conflict (allocation_id) do nothing;
end;
$$;

revoke all on function public.preparar_repasse_profissional(uuid) from public, anon, authenticated;

comment on function public.preparar_repasse_profissional(uuid) is
  'Prepara o repasse do job concluído (chamado por trigger). Fica em failed sem chave PIX '
  'OU sem verification_status = verificado — repasse a profissional não aprovado por um '
  'admin nunca sai automaticamente; precisa de intervenção via admin_intervir_repasse.';

-- ---------------------------------------------------------------------------
-- 3. salvar_chave_pix — avisa o profissional quando a própria chave muda
-- ---------------------------------------------------------------------------
alter table public.notification_outbox
  drop constraint notification_outbox_event_type_check;
alter table public.notification_outbox
  add constraint notification_outbox_event_type_check check (event_type in (
    'quote_request_received', 'quote_received', 'quote_accepted',
    'quote_cancelled', 'quote_declined', 'new_message', 'job_updated',
    'appointment_proposed', 'appointment_confirmed', 'appointment_cancelled',
    'appointment_reminder', 'pmoc_offered', 'pmoc_activated', 'pmoc_visit_due',
    'purchase_order_created', 'purchase_order_updated',
    'payment_received', 'subscription_overdue', 'pix_key_changed'
  ));

alter table public.notification_outbox
  drop constraint notification_outbox_aggregate_type_check;
alter table public.notification_outbox
  add constraint notification_outbox_aggregate_type_check check (aggregate_type in (
    'quote_request', 'job', 'conversation', 'appointment', 'pmoc_plan', 'pmoc_visit',
    'purchase_order', 'plan_subscription', 'professional'
  ));

create or replace function public.salvar_chave_pix(p_chave text, p_tipo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_chave      text := btrim(coalesce(p_chave, ''));
  v_chave_era  text;
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;
  if p_tipo not in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria') then
    raise exception 'Tipo de chave PIX inválido.';
  end if;
  if v_chave = '' then
    raise exception 'Informe a chave PIX.';
  end if;
  if p_tipo in ('cpf', 'cnpj') and v_chave !~ '^[0-9]{11}$|^[0-9]{14}$' then
    raise exception 'CPF ou CNPJ inválido — use só números.';
  end if;

  select chave_pix into v_chave_era from public.professionals where id = v_uid;

  update public.professionals
     set chave_pix = v_chave, chave_pix_tipo = p_tipo
   where id = v_uid;

  if not found then
    raise exception 'Perfil de profissional não encontrado.';
  end if;

  -- Aviso operacional obrigatório de segurança — não passa por preferência,
  -- mesmo padrão de purchase_order_created/updated (20260818110000): quem
  -- troca a própria chave precisa ficar sabendo, mesmo que tenha desligado
  -- notificações de "atualização do serviço".
  if v_chave_era is distinct from v_chave then
    insert into public.notification_outbox (
      recipient_id, event_type, aggregate_type, aggregate_id,
      payload, dedupe_key, inapp_allowed, email_allowed, whatsapp_allowed
    ) values (
      v_uid, 'pix_key_changed', 'professional', v_uid,
      jsonb_build_object('chave_pix_tipo', p_tipo),
      format('pix_key_changed:%s:%s', v_uid, gen_random_uuid()),
      true, false, false
    )
    on conflict (dedupe_key) do nothing;
  end if;
end;
$$;

revoke all on function public.salvar_chave_pix(text, text) from public, anon;
grant execute on function public.salvar_chave_pix(text, text) to authenticated;

comment on function public.salvar_chave_pix(text, text) is
  'Profissional cadastra ou troca a própria chave PIX — destino do repasse automático de '
  'cada job concluído. Toda troca real gera uma notificação in-app obrigatória, para o dono '
  'da conta perceber se não foi ele quem mudou.';
