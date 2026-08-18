-- ============================================================================
-- Cancelamento de assinatura pelo profissional
-- ============================================================================
--
-- Duas situações bem diferentes contam como "cancelar":
--
--   1. Ainda não pagou nada (`pending_first_payment`): não há período a
--      preservar. Cancela na hora — mesmo padrão de troca de plano antes de
--      pagar (20260818149000).
--
--   2. Já pagou o ciclo atual (`active`/`overdue`): decisão do time
--      (18/08/2026) é manter acesso até `next_due_date` — cortar na hora
--      seria cobrar por um período e entregar menos. `auto_renova` vira
--      false; o status permanece o que já era. Sem worker de renovação
--      construído ainda, isso hoje só marca a intenção — o efeito prático
--      (parar de gerar a próxima cobrança) é responsabilidade de quando esse
--      worker existir.
--
-- As duas situações podem deixar uma fatura pendente vinculada ao Asaas para
-- cancelar do lado de lá — a RPC devolve o `gateway_payment_id` quando existe
-- um, para a Edge Function chamar a API do Asaas depois. A RPC nunca fala
-- com o Asaas diretamente (não tem acesso de rede).

alter table public.plan_subscriptions
  add column if not exists auto_renova boolean not null default true;
comment on column public.plan_subscriptions.auto_renova is
  'false = profissional pediu cancelamento. Mantém status/acesso até next_due_date; não gera a próxima cobrança quando o worker de renovação existir.';

create or replace function public.cancelar_assinatura(p_professional_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.plan_subscriptions%rowtype;
  v_gateway_payment_id text;
begin
  select * into v_sub from public.plan_subscriptions
   where professional_id = p_professional_id
     and status in ('pending_first_payment', 'active', 'overdue')
   for update;
  if not found then raise exception 'Nenhuma assinatura para cancelar.'; end if;

  if v_sub.status = 'pending_first_payment' then
    select gateway_payment_id into v_gateway_payment_id
      from public.payment_charges
     where subscription_id = v_sub.id
       and status in ('pending_creation', 'pending', 'confirmed')
       and gateway_payment_id is not null
     limit 1;

    update public.payment_charges
       set status = 'cancelled'
     where subscription_id = v_sub.id
       and status in ('pending_creation', 'pending', 'confirmed');

    update public.plan_subscriptions
       set status = 'cancelled', cancelled_at = now()
     where id = v_sub.id;
  else
    -- active / overdue: já pagou o ciclo corrente, mantém como está até
    -- next_due_date. Nada de cobrança pendente para cancelar aqui — a fatura
    -- deste ciclo já foi liquidada.
    update public.plan_subscriptions
       set auto_renova = false, cancelled_at = now()
     where id = v_sub.id;
  end if;

  return v_gateway_payment_id;
end;
$$;

revoke all on function public.cancelar_assinatura(uuid) from public, anon, authenticated;
grant execute on function public.cancelar_assinatura(uuid) to service_role;

-- Leitura antes de agir: `asaas-assinar` chama isto ANTES de
-- `preparar_assinatura_plano` para saber se precisa cancelar uma fatura no
-- Asaas quando o profissional troca de plano antes de pagar. Só olha, não
-- muda nada — a mudança real continua sendo `preparar_assinatura_plano`.
create or replace function public.assinatura_pendente_para_trocar(
  p_professional_id uuid,
  p_plan_id uuid,
  p_ciclo text
)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select c.gateway_payment_id
    from public.plan_subscriptions s
    join public.payment_charges c on c.subscription_id = s.id
   where s.professional_id = p_professional_id
     and s.status = 'pending_first_payment'
     and (s.plan_id is distinct from p_plan_id or s.ciclo is distinct from p_ciclo)
     and c.status in ('pending_creation', 'pending', 'confirmed')
     and c.gateway_payment_id is not null
   limit 1;
$$;

revoke all on function public.assinatura_pendente_para_trocar(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.assinatura_pendente_para_trocar(uuid, uuid, text)
  to service_role;

-- Leitura própria: o profissional vê a própria assinatura vigente (a mais
-- recente entre pending_first_payment/active/overdue). Direto para
-- `authenticated`, sem passar por Edge Function — é leitura, escopo próprio
-- via auth.uid(), mesmo padrão de `meu_cpf_cnpj_professional`.
create or replace function public.minha_assinatura_atual()
returns table (
  subscription_id uuid,
  plano_slug text,
  plano_nome text,
  ciclo text,
  valor numeric,
  status text,
  auto_renova boolean,
  next_due_date date
)
language sql
security definer
stable
set search_path = public
as $$
  select s.id, sp.slug, sp.nome, s.ciclo, s.amount, s.status, s.auto_renova, s.next_due_date
    from public.plan_subscriptions s
    join public.subscription_plans sp on sp.id = s.plan_id
   where s.professional_id = (select auth.uid())
     and s.status in ('pending_first_payment', 'active', 'overdue')
   order by s.created_at desc
   limit 1;
$$;

revoke all on function public.minha_assinatura_atual() from public, anon;
grant execute on function public.minha_assinatura_atual() to authenticated;
