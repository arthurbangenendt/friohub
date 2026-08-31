-- ============================================================================
-- Fecha o gate de plano nas mutações — hoje só é checado na renderização
--
-- `plano_permite(professional_id, feature)` (20260819210000) já existe e já é
-- chamada nas 5 telas (`pmoc`, `ferramentas`, `desempenho`, `clientes`,
-- `oportunidades`) antes de renderizar. Mas nenhuma mutação por trás repete a
-- checagem — nem RLS, nem RPC, nem server action. Um profissional no plano
-- Grátis, chamando a action/RPC direto (ou a REST API do Supabase com o
-- próprio JWT), usa qualquer uma das 5 áreas normalmente. Financeiro tem o
-- mesmo problema (feature `custos_obra`), apesar de não fazer parte do lote
-- original — mesma classe de bug, fechado junto.
--
-- Agenda fica de fora de propósito: `propor_agendamento`/`responder_
-- agendamento`/`cancelar_agendamento` são compartilhadas com o cliente
-- (`v_uid in (cliente_id, profissional_id)`) — gatear ali travaria o cliente
-- também. É decisão de produto separada.
-- ============================================================================

set lock_timeout = '5s';
set statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- Parte 1 — RPCs que já existem: só falta o `raise exception` a mais.
-- ---------------------------------------------------------------------------

create or replace function public.criar_follow_up(
  p_quote_request_id uuid,
  p_due_at timestamptz,
  p_title text default 'Retornar contato'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null or not exists (
    select 1 from public.quote_request_targets target
     where target.quote_request_id = p_quote_request_id
       and target.professional_id = v_uid
  ) then raise exception 'Acesso negado à oportunidade.'; end if;
  if not public.plano_permite(v_uid, 'oportunidades') then
    raise exception 'Follow-up de oportunidades é exclusivo do seu plano.';
  end if;
  if p_due_at is null or p_due_at < now() - interval '5 minutes'
     or p_due_at > now() + interval '1 year' then
    raise exception 'Data de follow-up inválida.';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 2 and 160 then
    raise exception 'Informe um título válido.';
  end if;

  insert into public.follow_up_tasks (quote_request_id, professional_id, title, due_at)
  values (p_quote_request_id, v_uid, btrim(p_title), p_due_at)
  returning id into v_id;
  insert into public.follow_up_events (task_id, actor_id, event_type, metadata)
  values (v_id, v_uid, 'created', jsonb_build_object('due_at', p_due_at, 'title', btrim(p_title)));
  return v_id;
end;
$$;

create or replace function public.adiar_follow_up(p_task_id uuid, p_due_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.plano_permite(v_uid, 'oportunidades') then
    raise exception 'Follow-up de oportunidades é exclusivo do seu plano.';
  end if;
  if p_due_at is null or p_due_at < now() or p_due_at > now() + interval '1 year' then
    raise exception 'Data de follow-up inválida.';
  end if;
  update public.follow_up_tasks set due_at = p_due_at
   where id = p_task_id and professional_id = v_uid and status = 'pending';
  if not found then raise exception 'Follow-up pendente não encontrado.'; end if;
  insert into public.follow_up_events (task_id, actor_id, event_type, metadata)
  values (p_task_id, v_uid, 'rescheduled', jsonb_build_object('due_at', p_due_at));
end;
$$;

create or replace function public.concluir_follow_up(
  p_task_id uuid,
  p_outcome text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.plano_permite(v_uid, 'oportunidades') then
    raise exception 'Follow-up de oportunidades é exclusivo do seu plano.';
  end if;
  if p_outcome not in ('contacted', 'no_response', 'converted', 'lost', 'rescheduled', 'other') then
    raise exception 'Resultado de follow-up inválido.';
  end if;
  if char_length(coalesce(p_notes, '')) > 1000 then raise exception 'Observações muito longas.'; end if;
  update public.follow_up_tasks
     set status = 'completed', outcome = p_outcome,
         notes = nullif(btrim(coalesce(p_notes, '')), ''), completed_at = now()
   where id = p_task_id and professional_id = v_uid and status = 'pending';
  if not found then raise exception 'Follow-up pendente não encontrado.'; end if;
  insert into public.follow_up_events (task_id, actor_id, event_type, metadata)
  values (p_task_id, v_uid, 'completed', jsonb_build_object('outcome', p_outcome));
end;
$$;

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

  if not exists (
    select 1 from public.professionals pr
     where pr.id = v_uid and pr.verification_status = 'verificado'
  ) then
    raise exception 'Apenas profissionais verificados podem propor um PMOC.';
  end if;

  if not public.plano_permite(v_uid, 'pmoc') then
    raise exception 'Propor PMOC é exclusivo do seu plano.';
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = p_client_id and p.role = 'cliente'
  ) then
    raise exception 'Cliente não encontrado.';
  end if;

  if char_length(btrim(coalesce(p_company_name, ''))) not between 2 and 160 then
    raise exception 'Informe a razão social.';
  end if;
  if char_length(btrim(coalesce(p_site_name, ''))) not between 2 and 160 then
    raise exception 'Informe o nome da unidade.';
  end if;
  if length(v_cep) <> 8 then
    raise exception 'Informe um CEP válido.';
  end if;
  if char_length(btrim(coalesce(p_cidade, ''))) < 2 then
    raise exception 'Informe a cidade.';
  end if;
  if p_equipment_count is null or p_equipment_count < 1 or p_equipment_count > 10000 then
    raise exception 'Informe a quantidade de equipamentos.';
  end if;
  if p_interval_months not in (1, 2, 3, 6, 12) then
    raise exception 'Periodicidade inválida.';
  end if;
  if coalesce(p_price_per_visit, 0) <= 0 then
    raise exception 'Informe o valor por visita.';
  end if;
  if p_first_due_date is null or p_first_due_date < current_date or p_first_due_date > current_date + 365 then
    raise exception 'Data da primeira visita inválida.';
  end if;

  insert into public.pmoc_plans (
    professional_id, client_id, company_name, site_name, cep, cidade,
    equipment_count, interval_months, price_per_visit, next_due_date, status
  ) values (
    v_uid, p_client_id, btrim(p_company_name), btrim(p_site_name), v_cep, btrim(p_cidade),
    p_equipment_count, p_interval_months, round(p_price_per_visit, 2), p_first_due_date, 'active'
  )
  returning id into v_id;

  insert into public.pmoc_visits (plan_id, due_date) values (v_id, p_first_due_date);
  insert into public.pmoc_plan_events (plan_id, actor_id, event_type, metadata)
  values (v_id, v_uid, 'proposed_by_professional', jsonb_build_object(
    'price_per_visit', round(p_price_per_visit, 2), 'first_due_date', p_first_due_date
  ));
  perform public.enqueue_notification(
    p_client_id, 'pmoc_proposed', 'pmoc_plan', v_id,
    jsonb_build_object('company_name', btrim(p_company_name), 'price_per_visit', round(p_price_per_visit, 2)),
    format('pmoc-proposed:%s', v_id)
  );
  return v_id;
end;
$$;

create or replace function public.responder_pmoc(
  p_plan_id uuid,
  p_accept boolean,
  p_price_per_visit numeric default null,
  p_first_due_date date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_plan public.pmoc_plans%rowtype;
begin
  select * into v_plan from public.pmoc_plans where id = p_plan_id for update;
  if not found then raise exception 'Solicitação PMOC não encontrada.'; end if;
  if v_uid is null or v_plan.professional_id is distinct from v_uid then raise exception 'Acesso negado.'; end if;
  if not public.plano_permite(v_uid, 'pmoc') then
    raise exception 'PMOC é exclusivo do seu plano.';
  end if;
  if v_plan.status <> 'offered' then raise exception 'PMOC não está aguardando resposta.'; end if;

  if not coalesce(p_accept, false) then
    update public.pmoc_plans set professional_id = null, status = 'requested' where id = p_plan_id;
    insert into public.pmoc_plan_events (plan_id, actor_id, event_type)
    values (p_plan_id, v_uid, 'declined');
    return;
  end if;

  if coalesce(p_price_per_visit, 0) <= 0 then raise exception 'Informe o valor por visita.'; end if;
  if p_first_due_date is null or p_first_due_date < current_date
     or p_first_due_date > current_date + 365 then
    raise exception 'Data da primeira visita inválida.';
  end if;

  update public.pmoc_plans
     set status = 'active', price_per_visit = round(p_price_per_visit, 2),
         next_due_date = (p_first_due_date + make_interval(months => interval_months))::date
   where id = p_plan_id;
  insert into public.pmoc_visits (plan_id, due_date) values (p_plan_id, p_first_due_date);
  insert into public.pmoc_plan_events (plan_id, actor_id, event_type, metadata)
  values (p_plan_id, v_uid, 'accepted', jsonb_build_object(
    'price_per_visit', round(p_price_per_visit, 2), 'first_due_date', p_first_due_date
  ));
  perform public.enqueue_notification(
    v_plan.client_id, 'pmoc_activated', 'pmoc_plan', p_plan_id,
    jsonb_build_object('first_due_date', p_first_due_date, 'price_per_visit', round(p_price_per_visit, 2)),
    format('pmoc-activated:%s', p_plan_id)
  );
end;
$$;

create or replace function public.concluir_visita_pmoc(
  p_visit_id uuid,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_visit public.pmoc_visits%rowtype;
  v_plan public.pmoc_plans%rowtype;
begin
  select * into v_visit from public.pmoc_visits where id = p_visit_id for update;
  if not found then raise exception 'Visita PMOC não encontrada.'; end if;
  select * into v_plan from public.pmoc_plans where id = v_visit.plan_id;
  if v_uid is null or v_plan.professional_id is distinct from v_uid then raise exception 'Acesso negado.'; end if;
  if not public.plano_permite(v_uid, 'pmoc') then
    raise exception 'PMOC é exclusivo do seu plano.';
  end if;
  if v_visit.status <> 'planned' then raise exception 'Visita PMOC não está pendente.'; end if;
  if char_length(coalesce(p_notes, '')) > 4000 then raise exception 'Observações muito longas.'; end if;

  update public.pmoc_visits
     set status = 'completed', completed_at = now(), completion_notes = nullif(btrim(coalesce(p_notes, '')), '')
   where id = p_visit_id;
  insert into public.pmoc_plan_events (plan_id, actor_id, event_type, metadata)
  values (v_plan.id, v_uid, 'visit_completed', jsonb_build_object('visit_id', p_visit_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Parte 2 — Tabelas sem RPC no meio (Ferramentas, Clientes, Financeiro):
-- reforço na própria RLS, chamando plano_permite() de dentro da policy —
-- fecha o buraco pra qualquer caminho de acesso, não só a UI do app.
-- SELECT e DELETE continuam sem o gate: não faz sentido travar quem quer ver
-- ou apagar o próprio dado depois de um downgrade de plano.
-- ---------------------------------------------------------------------------

drop policy if exists "professional_tools_owner_insert" on public.professional_tools;
create policy "professional_tools_owner_insert"
  on public.professional_tools for insert to authenticated
  with check ((select auth.uid()) = professional_id and public.plano_permite(professional_id, 'ferramentas'));

-- `notes_professional` era `for all` numa política só — dividida por
-- operação (mesmo padrão já usado em `jobs`, ver 20260812220000) pra poder
-- gatear insert/update sem mexer em select/delete.
drop policy if exists "notes_professional" on public.professional_client_notes;

create policy "professional_client_notes_select"
  on public.professional_client_notes for select to authenticated
  using (professional_id = (select auth.uid()) or (select public.eh_admin()));

create policy "professional_client_notes_insert"
  on public.professional_client_notes for insert to authenticated
  with check (
    professional_id = (select auth.uid())
    and public.plano_permite(professional_id, 'clientes')
    and exists (select 1 from public.jobs j where j.cliente_id = customer_id and j.profissional_id = (select auth.uid()))
  );

create policy "professional_client_notes_update"
  on public.professional_client_notes for update to authenticated
  using (professional_id = (select auth.uid()))
  with check (
    professional_id = (select auth.uid())
    and public.plano_permite(professional_id, 'clientes')
    and exists (select 1 from public.jobs j where j.cliente_id = customer_id and j.profissional_id = (select auth.uid()))
  );

create policy "professional_client_notes_delete"
  on public.professional_client_notes for delete to authenticated
  using (professional_id = (select auth.uid()));

-- `expenses_owner_all` era `for all` numa política só — mesma divisão.
--
-- Exceção necessária: `link_professional_tool_expense()` (20260814173334) é
-- `security invoker` e insere a despesa `categoria='ferramenta'` DENTRO da
-- mesma transação de `registrarFerramenta` — sujeita a esta RLS. Um
-- profissional do Essencial tem `ferramentas` mas não `custos_obra`; sem essa
-- exceção, cadastrar uma ferramenta com preço quebraria a transação inteira
-- (o INSERT em professional_tools seria revertido junto). A categoria
-- 'ferramenta' já é gated por 'ferramentas' no próprio cadastro que a gera —
-- não é uma porta aberta para custos arbitrários.
drop policy if exists "expenses_owner_all" on public.expenses;

create policy "expenses_owner_select"
  on public.expenses for select
  using (auth.uid() = professional_id);

create policy "expenses_owner_insert"
  on public.expenses for insert
  with check (
    auth.uid() = professional_id
    and (categoria = 'ferramenta' or public.plano_permite(professional_id, 'custos_obra'))
  );

create policy "expenses_owner_update"
  on public.expenses for update
  using (auth.uid() = professional_id)
  with check (
    auth.uid() = professional_id
    and (categoria = 'ferramenta' or public.plano_permite(professional_id, 'custos_obra'))
  );

create policy "expenses_owner_delete"
  on public.expenses for delete
  using (auth.uid() = professional_id);
