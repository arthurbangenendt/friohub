-- ============================================================================
-- Correção: escolher outro plano antes de pagar sempre devolvia o primeiro
-- ============================================================================
--
-- `preparar_assinatura_plano` só checava "existe assinatura em aberto para
-- este profissional", sem comparar plano/ciclo — então clicar em qualquer
-- cartão depois do primeiro devolvia sempre a mesma `plan_subscriptions`
-- (e a mesma `payment_charges`, já vinculada ao Asaas com o valor antigo).
-- Achado testando em produção/sandbox: cliques em Essencial e Master sempre
-- levavam para o checkout de R$100 do Profissional.
--
-- Antes de qualquer pagamento (`pending_first_payment`), o profissional pode
-- mudar de ideia livremente: cancela a tentativa antiga e abre uma nova —
-- não atualiza a linha existente porque isso manteria o mesmo
-- `subscription_id` e, por consequência, a mesma chave de idempotência do dia
-- em `preparar_cobranca_assinatura`, devolvendo de novo a cobrança antiga com
-- o valor congelado errado. Uma linha nova garante cobrança nova.
--
-- Depois de `active`/`overdue` (já pagou ao menos uma vez), o comportamento
-- continua o mesmo de antes — trocar de plano em assinatura corrente é fluxo
-- de upgrade/downgrade com prorateamento, fora de escopo aqui.

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
  v_existing_plan_id uuid;
  v_existing_ciclo text;
  v_existing_status text;
  v_id uuid;
  v_cidade text;
  v_estado text;
  v_cobranca_ativa boolean;
begin
  if p_ciclo not in ('mensal', 'anual') then raise exception 'Ciclo inválido.'; end if;

  select id, plan_id, ciclo, status
    into v_existing_id, v_existing_plan_id, v_existing_ciclo, v_existing_status
    from public.plan_subscriptions
   where professional_id = p_professional_id
     and status in ('pending_first_payment', 'active', 'overdue');

  if v_existing_id is not null then
    if v_existing_status = 'pending_first_payment'
       and (v_existing_plan_id is distinct from p_plan_id or v_existing_ciclo is distinct from p_ciclo) then
      update public.plan_subscriptions
         set status = 'cancelled', cancelled_at = now()
       where id = v_existing_id;
      update public.payment_charges
         set status = 'cancelled'
       where subscription_id = v_existing_id
         and status in ('pending_creation', 'pending');
      -- segue para criar uma linha nova abaixo, com plano/ciclo pedidos agora.
    else
      return v_existing_id;
    end if;
  end if;

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
