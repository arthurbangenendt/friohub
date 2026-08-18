-- ============================================================================
-- Correção: 20260818140000 foi editada DEPOIS de já aplicada no remoto
-- ============================================================================
--
-- `preparar_assinatura_plano` ganhou a checagem de `city_billing_config` no
-- arquivo fonte antes de qualquer deploy real acontecer, mas o `supabase db
-- push` já tinha marcado 20260818140000 como aplicada com a versão SEM a
-- trava. CREATE OR REPLACE aqui garante que o remoto fique igual ao arquivo
-- fonte, independente de quando cada ambiente rodou a migration original.

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
  v_cobranca_ativa boolean;
begin
  if p_ciclo not in ('mensal', 'anual') then raise exception 'Ciclo inválido.'; end if;

  select id into v_existing_id from public.plan_subscriptions
   where professional_id = p_professional_id
     and status in ('pending_first_payment', 'active', 'overdue');
  if v_existing_id is not null then return v_existing_id; end if;

  -- [RISCO 1, 20260813190000] O kill switch por cidade é a decisão de negócio
  -- de quando cobrar de verdade. Checar só na UI não protege nada — quem
  -- chama a Edge Function direto contornaria. A trava vive aqui, na única
  -- porta de entrada de uma nova assinatura.
  select cidade into v_cidade from public.professionals where id = p_professional_id;
  select cobranca_ativa into v_cobranca_ativa from public.city_billing_config where cidade = v_cidade;
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
