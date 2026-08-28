-- ============================================================================
-- Repasse automático à distribuidora — mesmo desenho e mesma proteção contra
-- fraude do repasse ao profissional (20260819140000_payment_transfers.sql)
--
-- O profissional se autodeclara "concluído" (`concluirJob()`, sem confirmação
-- do cliente) e por isso o repasse dele NUNCA dispara na hora — só prepara o
-- registro com uma janela de contenção (`platform_config.
-- repasse_janela_contencao_horas`) antes do Pix sair de verdade, dando tempo
-- do cliente contestar via `contestar_execucao_job`.
--
-- O MESMO padrão de autodeclaração existe na distribuidora: é ela mesma quem
-- marca a própria entrega como `entregue` via `avancar_purchase_order`. Sem a
-- mesma proteção, uma distribuidora mal-intencionada declara entrega falsa e
-- recebe o repasse antes de qualquer um perceber — por isso o gatilho, a
-- janela de contenção e a contestação abaixo espelham 1:1 o desenho já
-- aprovado para o profissional.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. `payment_transfers` passa a suportar Pix OU transferência bancária
--    (TED), e ganha `purchase_order_id` pra desambiguar qual entrega (um
--    order pode ter mais de uma distribuidora/purchase_order) cada
--    transferência de distribuidora pertence.
-- ---------------------------------------------------------------------------
alter table public.payment_transfers
  add column purchase_order_id uuid references public.purchase_orders (id),
  add column metodo text not null default 'pix' check (metodo in ('pix', 'ted')),
  add column banco_codigo text,
  add column banco_agencia text,
  add column banco_conta text,
  add column banco_conta_digito text,
  add column banco_conta_tipo text check (banco_conta_tipo in ('conta_corrente', 'conta_poupanca')),
  add column banco_titular_nome text,
  add column banco_titular_documento text;

alter table public.payment_transfers
  alter column pix_key drop not null,
  alter column pix_key_type drop not null;

alter table public.payment_transfers
  add constraint payment_transfers_metodo_consistente check (
    (metodo = 'pix' and pix_key is not null and pix_key_type is not null
     and banco_codigo is null and banco_agencia is null and banco_conta is null)
    or
    (metodo = 'ted' and banco_codigo is not null and banco_agencia is not null
     and banco_conta is not null and banco_conta_digito is not null
     and banco_titular_nome is not null and banco_titular_documento is not null
     and (pix_key is null or pix_key = '') and (pix_key_type is null or pix_key_type = ''))
  );

create index idx_payment_transfers_purchase_order on public.payment_transfers (purchase_order_id)
  where purchase_order_id is not null;

comment on column public.payment_transfers.purchase_order_id is
  'Só preenchido para repasse de distribuidora — um order pode ter várias distribuidoras/purchase_orders, isso desambigua qual transferência pertence a qual entrega.';

-- ---------------------------------------------------------------------------
-- 2. Preparo do repasse — mesma estrutura de `preparar_repasse_profissional`,
--    disparado pela ENTREGA (purchase_orders), não pela conclusão do job.
-- ---------------------------------------------------------------------------
create or replace function public.preparar_repasse_distribuidora(p_purchase_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po           public.purchase_orders%rowtype;
  v_job_id       uuid;
  v_charge_id    uuid;
  v_allocation   public.payment_allocations%rowtype;
  v_dist         public.distributors%rowtype;
  v_janela_horas int;
  v_metodo       text;
  v_pix_key      text := '';
  v_pix_key_type text := '';
begin
  select * into v_po from public.purchase_orders where id = p_purchase_order_id;
  if not found or v_po.status <> 'entregue' then
    return;
  end if;

  select job_id into v_job_id from public.orders where id = v_po.order_id;
  if v_job_id is null then
    return;
  end if;

  -- Só prepara repasse sobre dinheiro que a plataforma REALMENTE recebeu —
  -- mesma trava do profissional. `received` é liquidação de verdade.
  select id into v_charge_id
    from public.payment_charges
   where order_id = v_po.order_id and status = 'received'
   order by created_at desc
   limit 1;
  if v_charge_id is null then
    return;
  end if;

  select * into v_allocation
    from public.payment_allocations
   where charge_id = v_charge_id
     and allocation_type = 'distributor_payable'
     and beneficiary_id = v_po.distributor_id;
  if not found or v_allocation.amount <= 0 then
    return;
  end if;

  select * into v_dist from public.distributors where id = v_po.distributor_id;
  v_metodo := coalesce(v_dist.metodo_repasse, 'pix');
  if v_dist.metodo_repasse = 'pix' then
    v_pix_key := coalesce(v_dist.chave_pix, '');
    v_pix_key_type := coalesce(v_dist.chave_pix_tipo, '');
  end if;

  select coalesce(repasse_janela_contencao_horas, 48) into v_janela_horas
    from public.platform_config where id;

  insert into public.payment_transfers (
    allocation_id, order_id, job_id, purchase_order_id, beneficiary_id,
    gateway, idempotency_key, external_reference,
    metodo, pix_key, pix_key_type,
    banco_codigo, banco_agencia, banco_conta, banco_conta_digito,
    banco_conta_tipo, banco_titular_nome, banco_titular_documento,
    amount, status, scheduled_for, last_error, failed_at
  ) values (
    v_allocation.id, v_po.order_id, v_job_id, p_purchase_order_id, v_po.distributor_id,
    'asaas', format('purchase_order:%s:transfer', p_purchase_order_id), format('purchase_order:%s', p_purchase_order_id),
    v_metodo,
    v_pix_key, v_pix_key_type,
    case when v_dist.metodo_repasse = 'ted' then v_dist.banco_codigo end,
    case when v_dist.metodo_repasse = 'ted' then v_dist.banco_agencia end,
    case when v_dist.metodo_repasse = 'ted' then v_dist.banco_conta end,
    case when v_dist.metodo_repasse = 'ted' then v_dist.banco_conta_digito end,
    case when v_dist.metodo_repasse = 'ted' then v_dist.banco_conta_tipo end,
    case when v_dist.metodo_repasse = 'ted' then v_dist.banco_titular_nome end,
    case when v_dist.metodo_repasse = 'ted' then v_dist.banco_titular_documento end,
    v_allocation.amount,
    case when v_dist.metodo_repasse is null then 'failed' else 'pending_creation' end,
    now() + make_interval(hours => v_janela_horas),
    case when v_dist.metodo_repasse is null then 'Distribuidora sem forma de repasse cadastrada.' end,
    case when v_dist.metodo_repasse is null then now() end
  )
  on conflict (allocation_id) do nothing;
end;
$$;

revoke all on function public.preparar_repasse_distribuidora(uuid) from public, anon, authenticated;

create or replace function public.dispara_repasse_ao_entregar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'entregue' and old.status is distinct from 'entregue' then
    perform public.preparar_repasse_distribuidora(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_purchase_orders_dispara_repasse on public.purchase_orders;
create trigger trg_purchase_orders_dispara_repasse
  after update on public.purchase_orders
  for each row execute function public.dispara_repasse_ao_entregar();

-- ---------------------------------------------------------------------------
-- 3. `job_disputes` ganha o terceiro tipo ANTES da função que insere nele —
--    mesma fila do admin (/admin/disputas), sem precisar de tela nova.
-- ---------------------------------------------------------------------------
alter table public.job_disputes drop constraint if exists job_disputes_tipo_check;
alter table public.job_disputes add constraint job_disputes_tipo_check
  check (tipo in ('contestacao_pos_conclusao', 'cancelamento_em_execucao', 'contestacao_entrega_distribuidora'));

alter table public.job_disputes add column if not exists purchase_order_id uuid references public.purchase_orders (id);

comment on column public.job_disputes.purchase_order_id is
  'Só preenchido para tipo=contestacao_entrega_distribuidora — qual entrega específica está sendo contestada.';

-- ---------------------------------------------------------------------------
-- 4. Contestação: mesmo padrão JÁ CORRIGIDO de `contestar_execucao_job`
--    (20260825091000_abrir_disputa.sql) — SEMPRE cria a linha em
--    `job_disputes` (o que o admin vê e resolve), e só então bloqueia o
--    repasse se ainda for possível. Nunca deixa o cliente sem registro só
--    porque o repasse já saiu.
-- ---------------------------------------------------------------------------
create or replace function public.contestar_entrega_purchase_order(p_purchase_order_id uuid, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_motivo   text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_po       public.purchase_orders%rowtype;
  v_job_id   uuid;
  v_transfer public.payment_transfers%rowtype;
  v_situacao text;
  v_valor_referencia numeric(12,2);
  v_dispute_id uuid;
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;
  if v_motivo is null then
    raise exception 'Descreva o que houve com a entrega.';
  end if;

  select po.* into v_po
    from public.purchase_orders po
    join public.orders o on o.id = po.order_id
    join public.jobs j on j.id = o.job_id
   where po.id = p_purchase_order_id and j.cliente_id = v_uid;
  if not found then
    raise exception 'Entrega não encontrada.';
  end if;
  if v_po.status <> 'entregue' then
    raise exception 'Só é possível contestar uma entrega já marcada como entregue.';
  end if;

  select o.job_id into v_job_id from public.orders o where o.id = v_po.order_id;

  if exists (
    select 1 from public.job_disputes
     where purchase_order_id = p_purchase_order_id and status in ('aberta', 'processando_reembolso')
  ) then
    raise exception 'Já existe uma contestação em análise para esta entrega.';
  end if;

  -- valor_referencia é o que a distribuidora receberia por ESTA entrega —
  -- teto reembolsável escopado ao pedido dela, não ao order inteiro (que
  -- pode incluir mão de obra e outras distribuidoras).
  select coalesce(pa.amount, 0) into v_valor_referencia
    from public.payment_allocations pa
    join public.payment_charges pc on pc.id = pa.charge_id
   where pa.allocation_type = 'distributor_payable'
     and pa.beneficiary_id = v_po.distributor_id
     and pc.order_id = v_po.order_id
     and pc.status = 'received'
   order by pc.created_at desc
   limit 1;

  select * into v_transfer from public.payment_transfers
   where purchase_order_id = p_purchase_order_id
   order by requested_at desc
   limit 1
   for update;

  if found and v_transfer.status = 'pending_creation' then
    update public.payment_transfers
       set contestado_em = now(), contestado_motivo = v_motivo, status = 'cancelled'
     where id = v_transfer.id;
    v_situacao := 'bloqueado';
  elsif found and v_transfer.status in ('pending', 'confirmed') then
    v_situacao := 'ja_enviado';
  else
    v_situacao := 'sem_repasse';
  end if;

  insert into public.job_disputes (
    job_id, purchase_order_id, aberto_por, tipo, motivo, valor_referencia, situacao_repasse
  ) values (
    v_job_id, p_purchase_order_id, v_uid, 'contestacao_entrega_distribuidora',
    v_motivo, coalesce(v_valor_referencia, 0), v_situacao
  )
  returning id into v_dispute_id;

  return v_dispute_id;
end;
$$;

revoke all on function public.contestar_entrega_purchase_order(uuid, text) from public, anon;
grant execute on function public.contestar_entrega_purchase_order(uuid, text) to authenticated;

comment on function public.contestar_entrega_purchase_order is
  'Cliente abre uma disputa sobre UMA entrega (purchase_order) — mesmo padrão de contestar_execucao_job: sempre cria job_disputes, bloqueia o repasse se ainda estiver pending_creation.';
