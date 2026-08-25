-- ============================================================================
-- Tier 5 — As duas formas de abrir uma disputa
-- ============================================================================

set lock_timeout = '5s';
set statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 1. `contestar_execucao_job` muda de contrato.
--
--    ANTES: lançava exceção quando não havia `payment_transfers` bloqueável
--    (`pending_creation`) — o cliente que contestasse depois do repasse já
--    ter saído esbarrava num beco sem saída, sem admin nenhum sabendo que a
--    contestação existiu.
--
--    AGORA: sempre cria uma linha em `job_disputes` (o que o admin vê e
--    resolve em /admin/disputas) e só então tenta bloquear o repasse, se
--    ainda for possível. Muda o `returns void` para `returns uuid` — exige
--    `drop` antes do `create` (Postgres não troca tipo de retorno em
--    `create or replace`). Mesmo nome e parâmetros: zero mudança na action
--    `contestarExecucao` que já chama esta RPC.
--
--    ⚠️ Muda o comportamento esperado por
--    supabase/tests/database/102_repasse_automatico.test.sql — o caso que
--    hoje é `throws_ok` passa a ser `lives_ok`. Teste atualizado junto.
-- ---------------------------------------------------------------------------
drop function if exists public.contestar_execucao_job(uuid, text);

create function public.contestar_execucao_job(p_job_id uuid, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_motivo   text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_job      public.jobs%rowtype;
  v_transfer public.payment_transfers%rowtype;
  v_situacao text;
  v_valor_cobrado numeric(12,2);
  v_dispute_id uuid;
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;
  if v_motivo is null then
    raise exception 'Descreva o que houve com o serviço.';
  end if;

  select * into v_job from public.jobs where id = p_job_id and cliente_id = v_uid;
  if not found then
    raise exception 'Serviço não encontrado.';
  end if;
  if v_job.status <> 'concluido' then
    raise exception 'Só é possível contestar um serviço já concluído.';
  end if;

  if exists (select 1 from public.job_disputes where job_id = p_job_id and status in ('aberta', 'processando_reembolso')) then
    raise exception 'Já existe uma contestação em análise para este serviço.';
  end if;

  -- valor_referencia é o que o cliente PAGOU (teto reembolsável) — não o que
  -- o profissional receberia de repasse, que já é líquido de comissão.
  select coalesce(sum(pc.amount), 0) into v_valor_cobrado
    from public.payment_charges pc
    join public.orders o on o.id = pc.order_id
   where o.job_id = p_job_id and pc.status = 'received';

  select * into v_transfer from public.payment_transfers
   where job_id = p_job_id
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

  insert into public.job_disputes (job_id, aberto_por, tipo, motivo, valor_referencia, situacao_repasse)
  values (p_job_id, v_uid, 'contestacao_pos_conclusao', v_motivo, v_valor_cobrado, v_situacao)
  returning id into v_dispute_id;

  return v_dispute_id;
end;
$$;

revoke all on function public.contestar_execucao_job(uuid, text) from public, anon;
grant execute on function public.contestar_execucao_job(uuid, text) to authenticated;

comment on function public.contestar_execucao_job(uuid, text) is
  'Cliente abre uma disputa pós-conclusão. Bloqueia o repasse se ainda estiver pending_creation; sempre cria job_disputes para o admin revisar, mesmo quando o repasse já não pode mais ser travado.';

-- ---------------------------------------------------------------------------
-- 2. `solicitar_cancelamento_job_pago` — nova. Cliente pede pra cancelar um
--    job já pago e ainda em andamento (ex.: profissional não apareceu).
--
--    Não muda `jobs.status` aqui — fica como está até o admin decidir. Uma
--    rejeição não deixa nada pra desfazer, e o profissional continua vendo o
--    job normalmente enquanto a disputa está aberta.
-- ---------------------------------------------------------------------------
create or replace function public.solicitar_cancelamento_job_pago(p_job_id uuid, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_job    public.jobs%rowtype;
  v_valor  numeric(12,2);
  v_dispute_id uuid;
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;
  if v_motivo is null then
    raise exception 'Descreva o motivo do cancelamento.';
  end if;

  select * into v_job from public.jobs where id = p_job_id and cliente_id = v_uid for update;
  if not found then
    raise exception 'Serviço não encontrado.';
  end if;
  if v_job.status not in ('aceito', 'em_execucao', 'aguardando_orcamento_final') then
    raise exception 'Este serviço não pode ser cancelado neste estágio.';
  end if;

  if exists (select 1 from public.job_disputes where job_id = p_job_id and status in ('aberta', 'processando_reembolso')) then
    raise exception 'Já existe uma solicitação em análise para este serviço.';
  end if;

  select coalesce(sum(pc.amount), 0) into v_valor
    from public.payment_charges pc
    join public.orders o on o.id = pc.order_id
   where o.job_id = p_job_id and pc.status = 'received';

  if v_valor <= 0 then
    raise exception 'Não há cobrança liquidada para este serviço.';
  end if;

  insert into public.job_disputes (job_id, aberto_por, tipo, motivo, valor_referencia)
  values (p_job_id, v_uid, 'cancelamento_em_execucao', v_motivo, v_valor)
  returning id into v_dispute_id;

  return v_dispute_id;
end;
$$;

revoke all on function public.solicitar_cancelamento_job_pago(uuid, text) from public, anon;
grant execute on function public.solicitar_cancelamento_job_pago(uuid, text) to authenticated;

comment on function public.solicitar_cancelamento_job_pago(uuid, text) is
  'Cliente pede cancelamento + reembolso de um job pago ainda em andamento. Não muda jobs.status — fica pendente de decisão do admin em job_disputes.';
