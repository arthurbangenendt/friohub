-- ============================================================================
-- PMOC ORIGINADO PELO PROFISSIONAL
-- ============================================================================
--
-- O fluxo original só nasce no cliente: ele solicita, o admin atribui, o
-- profissional aceita. Isso deixa de fora o caso mais comum do mercado — o
-- técnico que JÁ atende três padarias com contrato de manutenção e quer trazer
-- essa carteira para dentro do sistema. Hoje ele teria que pedir a cada cliente
-- que entre no site, solicite, e torcer para o admin devolver o plano para ele.
-- Atrito suficiente para ele simplesmente não trazer.
--
-- Desenho escolhido: o profissional PROPÕE, o cliente ACEITA. A verificação
-- não é furada — continua exigindo `verification_status = 'verificado'`, o
-- mesmo piso de `atribuir_pmoc`. E quem valida a relação é o cliente, que é
-- quem paga. O admin sai do caminho sem que ninguém se auto-atribua contrato.
--
-- Trava contra proposta não solicitada: o profissional só propõe a cliente com
-- quem já tem histórico de serviço (`jobs`). Sem isso, o RPC viraria um canal
-- de spam para qualquer usuário da base.
--
-- ATENÇÃO — esta migration ALTERA duas constraints de tabelas criadas em
-- 20260813182838 (PMOC, de outra frente de trabalho):
--   * `pmoc_plans_status_check`        ganha o estado 'proposed'
--   * `pmoc_plan_events_event_type_check` ganha o evento 'proposed'
-- Se aquela frente também mexer nessas constraints, a última migration aplicada
-- vence e a outra precisa ser reescrita. Não há como adicionar estado a um
-- CHECK sem recriá-lo.
--
-- Deliberadamente NÃO altero `notification_outbox_event_type_check`: aquela
-- constraint já é editada pela outra frente e disputá-la é convite a conflito.
-- A proposta ao cliente reusa `pmoc_offered`, que descreve o fato corretamente
-- ("chegou uma oferta de PMOC"), apenas com outro destinatário.

-- ---------------------------------------------------------------------------
-- 1. Novo estado e origem
-- ---------------------------------------------------------------------------
alter table public.pmoc_plans
  drop constraint if exists pmoc_plans_status_check;
alter table public.pmoc_plans
  add constraint pmoc_plans_status_check
  check (status in ('requested', 'proposed', 'offered', 'active', 'paused', 'cancelled'));

alter table public.pmoc_plan_events
  drop constraint if exists pmoc_plan_events_event_type_check;
alter table public.pmoc_plan_events
  add constraint pmoc_plan_events_event_type_check
  check (event_type in ('requested', 'proposed', 'assigned', 'accepted', 'declined',
                        'visit_created', 'visit_completed', 'visit_cancelled',
                        'paused', 'cancelled'));

alter table public.pmoc_plans
  add column if not exists origin text not null default 'cliente'
  check (origin in ('cliente', 'profissional'));

comment on column public.pmoc_plans.origin is
  'Quem originou o plano. ''cliente'' segue o fluxo requested→offered→active; ''profissional'' segue proposed→active.';
comment on constraint pmoc_plans_status_check on public.pmoc_plans is
  '''proposed'' = proposto pelo profissional, aguardando o cliente. ''offered'' = atribuído pelo admin, aguardando o profissional.';

-- ---------------------------------------------------------------------------
-- 2. Profissional propõe
-- ---------------------------------------------------------------------------
create or replace function public.propor_pmoc_profissional(
  p_client_id        uuid,
  p_company_name     text,
  p_site_name        text,
  p_cep              text,
  p_cidade           text,
  p_equipment_count  integer,
  p_interval_months  integer,
  p_price_per_visit  numeric,
  p_first_due_date   date,
  p_notes            text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_cep  text := regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g');
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;

  -- Mesmo piso de qualidade de `atribuir_pmoc`: PMOC é contrato recorrente com
  -- obrigação técnica. Profissional não verificado não origina contrato.
  if not exists (
    select 1 from public.professionals pr
     where pr.id = v_uid and pr.verification_status = 'verificado'
  ) then
    raise exception 'Apenas profissionais verificados podem propor um PMOC.';
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = p_client_id and p.role = 'cliente'
  ) then
    raise exception 'Cliente não encontrado.';
  end if;

  -- Anti-spam: proposta só para quem já é cliente seu de fato.
  if not exists (
    select 1 from public.jobs j
     where j.cliente_id = p_client_id and j.profissional_id = v_uid
  ) then
    raise exception 'Você só pode propor PMOC para um cliente que já atendeu pelo FrioHub.';
  end if;

  if char_length(btrim(coalesce(p_company_name, ''))) not between 2 and 160 then
    raise exception 'Informe o nome da empresa.';
  end if;
  if char_length(btrim(coalesce(p_site_name, ''))) not between 2 and 160 then
    raise exception 'Informe a unidade atendida.';
  end if;
  if v_cep !~ '^[0-9]{8}$' then
    raise exception 'Informe um CEP válido.';
  end if;
  if p_equipment_count is null or p_equipment_count not between 1 and 10000 then
    raise exception 'Quantidade de equipamentos inválida.';
  end if;
  if p_interval_months is null or p_interval_months not in (1, 2, 3, 6, 12) then
    raise exception 'Periodicidade PMOC inválida.';
  end if;
  if coalesce(p_price_per_visit, 0) <= 0 then
    raise exception 'Informe o valor por visita.';
  end if;
  if p_first_due_date is null or p_first_due_date < current_date
     or p_first_due_date > current_date + 365 then
    raise exception 'Data da primeira visita inválida.';
  end if;
  if char_length(coalesce(p_notes, '')) > 4000 then
    raise exception 'Observações muito longas.';
  end if;

  /* `next_due_date` guarda a data proposta enquanto o plano está em 'proposed'.
     No aceite ela vira a primeira visita e avança um intervalo — exatamente o
     que `responder_pmoc` faz no caminho do admin. */
  insert into public.pmoc_plans (
    client_id, professional_id, company_name, site_name, cep, cidade,
    equipment_count, interval_months, notes, price_per_visit, next_due_date,
    status, origin
  ) values (
    p_client_id, v_uid, btrim(p_company_name), btrim(p_site_name), v_cep, p_cidade,
    p_equipment_count, p_interval_months, nullif(btrim(coalesce(p_notes, '')), ''),
    round(p_price_per_visit, 2), p_first_due_date, 'proposed', 'profissional'
  )
  returning id into v_id;

  insert into public.pmoc_plan_events (plan_id, actor_id, event_type, metadata)
  values (v_id, v_uid, 'proposed', jsonb_build_object(
    'price_per_visit', round(p_price_per_visit, 2),
    'first_due_date', p_first_due_date,
    'interval_months', p_interval_months
  ));

  perform public.enqueue_notification(
    p_client_id, 'pmoc_offered', 'pmoc_plan', v_id,
    jsonb_build_object(
      'site_name', btrim(p_site_name),
      'price_per_visit', round(p_price_per_visit, 2),
      'first_due_date', p_first_due_date
    ),
    format('pmoc-proposed:%s', v_id)
  );

  return v_id;
end;
$$;

revoke all on function public.propor_pmoc_profissional(
  uuid, text, text, text, text, integer, integer, numeric, date, text
) from public, anon;
grant execute on function public.propor_pmoc_profissional(
  uuid, text, text, text, text, integer, integer, numeric, date, text
) to authenticated;

comment on function public.propor_pmoc_profissional(
  uuid, text, text, text, text, integer, integer, numeric, date, text
) is 'Profissional verificado propõe PMOC a cliente que já atendeu. Nasce em ''proposed'', sem efeito até o aceite.';

-- ---------------------------------------------------------------------------
-- 3. Cliente responde
-- ---------------------------------------------------------------------------
create or replace function public.responder_proposta_pmoc(
  p_plan_id uuid,
  p_accept  boolean,
  p_reason  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_plan public.pmoc_plans;
begin
  select * into v_plan from public.pmoc_plans where id = p_plan_id;
  if not found then
    raise exception 'Proposta de PMOC não encontrada.';
  end if;
  if v_uid is null or v_plan.client_id is distinct from v_uid then
    raise exception 'Acesso negado.';
  end if;
  if v_plan.status <> 'proposed' then
    raise exception 'Esta proposta não está aguardando resposta.';
  end if;

  if not p_accept then
    update public.pmoc_plans set status = 'cancelled' where id = p_plan_id;
    insert into public.pmoc_plan_events (plan_id, actor_id, event_type, metadata)
    values (p_plan_id, v_uid, 'declined', jsonb_build_object(
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    ));
    return;
  end if;

  /* A data proposta pode ter passado enquanto a proposta esperava resposta.
     Aceitar para o passado criaria uma visita já vencida no mesmo instante. */
  if v_plan.next_due_date is null or v_plan.next_due_date < current_date then
    raise exception 'A data da primeira visita já passou. Peça uma nova proposta ao profissional.';
  end if;

  update public.pmoc_plans
     set status = 'active',
         next_due_date = (v_plan.next_due_date + make_interval(months => v_plan.interval_months))::date
   where id = p_plan_id;

  insert into public.pmoc_visits (plan_id, due_date)
  values (p_plan_id, v_plan.next_due_date)
  on conflict (plan_id, due_date) do nothing;

  insert into public.pmoc_plan_events (plan_id, actor_id, event_type, metadata)
  values (p_plan_id, v_uid, 'accepted', jsonb_build_object(
    'price_per_visit', v_plan.price_per_visit,
    'first_due_date', v_plan.next_due_date
  ));

  perform public.enqueue_notification(
    v_plan.professional_id, 'pmoc_activated', 'pmoc_plan', p_plan_id,
    jsonb_build_object('first_due_date', v_plan.next_due_date, 'price_per_visit', v_plan.price_per_visit),
    format('pmoc-activated:%s', p_plan_id)
  );
end;
$$;

revoke all on function public.responder_proposta_pmoc(uuid, boolean, text) from public, anon;
grant execute on function public.responder_proposta_pmoc(uuid, boolean, text) to authenticated;

comment on function public.responder_proposta_pmoc(uuid, boolean, text) is
  'Cliente aceita ou recusa PMOC proposto pelo profissional. O aceite ativa o plano e cria a primeira visita.';
