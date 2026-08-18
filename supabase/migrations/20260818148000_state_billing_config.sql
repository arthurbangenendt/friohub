-- ============================================================================
-- Cobrança por estado — mitigação de médio prazo para o match por cidade
-- ============================================================================
--
-- 20260818147000 corrigiu um caso pontual, mas a causa de fundo continua:
-- `professionals.cidade` pode vir de reverse-geocoding de terceiro
-- (BigDataCloud, ver src/lib/cep.ts) e nem sempre bate exato com a string
-- cadastrada em `city_billing_config`. Comparar por `estado` (sigla UF já
-- normalizada em toda a base, sem depender de geocoding externo) é um
-- critério mais estável para decidir se a cidade paga.
--
-- Desenho: tabela nova, não uma coluna a mais em `city_billing_config` — mantém
-- a tabela existente (e sua PK em `cidade`) intocada. `preparar_assinatura_plano`
-- passa a checar a cidade primeiro (permite ligar/desligar uma cidade específica,
-- inclusive como exceção dentro de um estado já ligado) e cai para o estado
-- só quando não existir linha de cidade para aquele profissional.

create table public.state_billing_config (
  estado          text primary key,
  cobranca_ativa  boolean not null default false,
  updated_at      timestamptz not null default now()
);
comment on table public.state_billing_config is
  'Kill switch de cobrança por estado — usado como fallback quando não há linha de city_billing_config para a cidade exata do profissional (mitiga divergência de texto vinda de geocoding de terceiro).';

alter table public.state_billing_config enable row level security;
create policy "state_billing_read_all" on public.state_billing_config for select using (true);
grant select on public.state_billing_config to anon, authenticated;
revoke insert, update, delete on public.state_billing_config from anon, authenticated;

create or replace function public.preparar_assinatura_plano(
  p_professional_id uuid,
  p_plan_id uuid,
  p_ciclo text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.subscription_plans%rowtype;
  v_amount numeric(12,2);
  v_existing_id uuid;
  v_id uuid;
  v_cidade text;
  v_estado text;
  v_cobranca_ativa boolean;
begin
  if p_ciclo not in ('mensal', 'anual') then raise exception 'Ciclo inválido.'; end if;

  select id into v_existing_id from public.plan_subscriptions
   where professional_id = p_professional_id
     and status in ('pending_first_payment', 'active', 'overdue');
  if v_existing_id is not null then return v_existing_id; end if;

  -- [RISCO 1, 20260813190000] Kill switch de negócio. Cidade exata tem
  -- prioridade (permite exceção pontual); estado é o fallback quando a
  -- cidade cadastrada não tem linha própria — ver 20260818148000.
  select cidade, estado into v_cidade, v_estado
    from public.professionals where id = p_professional_id;

  select cobranca_ativa into v_cobranca_ativa
    from public.city_billing_config where cidade = v_cidade;

  if v_cobranca_ativa is null then
    select cobranca_ativa into v_cobranca_ativa
      from public.state_billing_config where estado = v_estado;
  end if;

  if not coalesce(v_cobranca_ativa, false) then
    raise exception 'Cobrança ainda não está ativa para a sua cidade.';
  end if;

  select * into v_plan from public.subscription_plans
   where id = p_plan_id and ativo and publico;
  if not found then raise exception 'Plano indisponível.'; end if;

  v_amount := case p_ciclo when 'mensal' then v_plan.preco_mensal else v_plan.preco_anual end;
  if v_amount is null or v_amount <= 0 then raise exception 'Plano sem preço para este ciclo.'; end if;

  insert into public.plan_subscriptions (professional_id, plan_id, ciclo, amount)
  values (p_professional_id, p_plan_id, p_ciclo, v_amount)
  returning id into v_id;

  return v_id;
end;
$$;
