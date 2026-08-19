-- ============================================================================
-- Repasse automático ao profissional — reserva com janela de contenção
--
-- CONTEXTO DE RISCO (decisão já tomada com o dono do produto, registrada
-- aqui para quem mexer nisto depois): hoje `concluirJob()`
-- (`src/app/servico/[id]/actions.ts`) deixa SÓ o profissional marcar o job
-- como `concluido` — update direto, sem nenhuma confirmação do cliente (ver
-- `protege_job_transicao` em 20260812220000_trava_jobs_reviews.sql). Disparar
-- PIX automático e irreversível exatamente nesse evento é a porta de fraude
-- mais óbvia deste desenho: o profissional se autodeclara "concluído" e puxa
-- o repasse antes do cliente perceber algo errado.
--
-- Por isso o repasse NUNCA dispara na hora: esta migration só PREPARA o
-- registro (`payment_transfers`, status `pending_creation`) com
-- `scheduled_for` no futuro. Um consumidor futuro (edge function agendada,
-- ainda não construída) só deve processar o que tiver `scheduled_for <= now()`
-- E não tiver sido contestado. O cliente pode contestar a qualquer momento
-- dentro da janela via `contestar_execucao_job`.
--
-- Este arquivo é só a camada de banco — nenhuma chamada HTTP ao Asaas mora
-- aqui, e nada dispara dinheiro de verdade hoje: sem `payment_charges` com
-- `status = 'received'` (cobrança real ligada, ainda desativada por
-- `asaas_payments`), `preparar_repasse_profissional` não cria transferência
-- nenhuma — só teria o que repassar depois que a Melhoria 2 ligar a cobrança
-- na aceitação da proposta.
-- ============================================================================

alter table public.platform_config
  add column if not exists repasse_janela_contencao_horas int not null default 48
    check (repasse_janela_contencao_horas between 0 and 240);

comment on column public.platform_config.repasse_janela_contencao_horas is
  'Horas entre o job virar concluido e o repasse automático ser processado — dá tempo do '
  'cliente contestar antes do dinheiro sair. Ver contestar_execucao_job().';

create table public.payment_transfers (
  id                  uuid primary key default gen_random_uuid(),
  allocation_id       uuid not null references public.payment_allocations (id) on delete restrict,
  order_id            uuid not null references public.orders (id) on delete restrict,
  job_id              uuid not null references public.jobs (id) on delete restrict,
  beneficiary_id      uuid not null references public.profiles (id) on delete restrict,

  gateway             text not null check (gateway in ('asaas')),
  gateway_transfer_id text,
  idempotency_key     text not null,
  external_reference  text not null,

  -- Snapshot da chave PIX no momento do preparo — se o profissional trocar a
  -- chave depois, isto não é reescrito por baixo de uma transferência já
  -- preparada. Trocar de chave cria um novo ciclo, não edita o passado.
  pix_key             text not null,
  pix_key_type        text not null,
  amount              numeric(12,2) not null check (amount > 0),

  status              text not null default 'pending_creation'
                      check (status in ('pending_creation', 'pending', 'confirmed', 'failed', 'cancelled')),
  scheduled_for       timestamptz not null,

  requested_at        timestamptz not null default now(),
  confirmed_at        timestamptz,
  failed_at           timestamptz,
  last_error          text,

  contestado_em       timestamptz,
  contestado_motivo   text,

  updated_at          timestamptz not null default now(),

  unique (gateway, idempotency_key),
  unique (allocation_id)
);

create index idx_payment_transfers_job on public.payment_transfers (job_id);
create index idx_payment_transfers_beneficiary on public.payment_transfers (beneficiary_id, requested_at desc);
-- É o índice que o futuro processador de repasses varre: pendentes, na hora, sem contestação.
create index idx_payment_transfers_pendentes on public.payment_transfers (scheduled_for)
  where status = 'pending_creation' and contestado_em is null;

comment on table public.payment_transfers is
  'Repasse ao profissional por job concluído. Preparado com scheduled_for no futuro (janela de '
  'contenção) — nenhum processador ainda consome isto; construído junto com a chamada real ao '
  'Asaas Transfers, que valida separadamente se a conta suporta a API antes de existir.';

alter table public.payment_transfers enable row level security;

create policy "payment_transfers_beneficiario_read" on public.payment_transfers
  for select to authenticated
  using (beneficiary_id = (select auth.uid()) or (select public.eh_admin()));

grant select on public.payment_transfers to authenticated;
revoke insert, update, delete on public.payment_transfers from anon, authenticated;

create trigger trg_payment_transfers_touch
  before update on public.payment_transfers
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Preparo do repasse — chamado pelo trigger de conclusão do job.
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
  select chave_pix, chave_pix_tipo into v_chave, v_chave_tipo
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
    case when v_chave is null then 'failed' else 'pending_creation' end,
    now() + make_interval(hours => v_janela_horas),
    case when v_chave is null then 'Profissional sem chave PIX cadastrada.' end,
    case when v_chave is null then now() end
  )
  on conflict (allocation_id) do nothing;
end;
$$;

revoke all on function public.preparar_repasse_profissional(uuid) from public, anon, authenticated;

create or replace function public.dispara_repasse_ao_concluir()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'concluido' and old.status is distinct from 'concluido' then
    perform public.preparar_repasse_profissional(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jobs_dispara_repasse on public.jobs;
create trigger trg_jobs_dispara_repasse
  after update on public.jobs
  for each row execute function public.dispara_repasse_ao_concluir();

-- ---------------------------------------------------------------------------
-- Contestação: o cliente trava o repasse dentro da janela de contenção.
-- ---------------------------------------------------------------------------
create or replace function public.contestar_execucao_job(p_job_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;
  if v_motivo is null then
    raise exception 'Descreva o que houve com o serviço.';
  end if;

  if not exists (
    select 1 from public.jobs where id = p_job_id and cliente_id = v_uid
  ) then
    raise exception 'Serviço não encontrado.';
  end if;

  update public.payment_transfers
     set contestado_em = now(), contestado_motivo = v_motivo, status = 'cancelled'
   where job_id = p_job_id
     and status = 'pending_creation'
     and contestado_em is null;

  if not found then
    raise exception 'Não há repasse pendente para contestar neste serviço — ele já foi processado ou ainda não foi preparado.';
  end if;
end;
$$;

revoke all on function public.contestar_execucao_job(uuid, text) from public, anon;
grant execute on function public.contestar_execucao_job(uuid, text) to authenticated;

comment on function public.contestar_execucao_job(uuid, text) is
  'Cliente trava o repasse automático de um job dentro da janela de contenção. Não desfaz a '
  'conclusão do job — só bloqueia o pagamento e sinaliza para resolução manual do financeiro.';
