-- ============================================================================
-- Receita da plataforma + GMV, mês a mês
-- ============================================================================
--
-- Nenhuma tela mostra receita hoje. O mais perto é o "Movimento por conta" de
-- /admin/financeiro, que é saldo ACUMULADO desde sempre, sem corte por mês —
-- não responde "quanto faturamos esse mês" nem "está subindo ou descendo".
-- Isso importa porque `asaas_payments` já está ativo em produção
-- (20260819180000) — pode já existir dinheiro real sem ninguém ver quanto.
--
-- SINAL DO `direction`, não é opcional entender isto antes de mexer aqui: as
-- três contas de receita (`platform_commission`, `platform_product_margin`,
-- `platform_subscription_revenue`) são CREDITADAS no recebimento
-- (20260813172401:530-620, 20260818140000:385-393) — reembolso inverte pra
-- debit. É o OPOSTO da convenção "saldo líquido" (`debit = +1`) que
-- admin/financeiro usa pro "Movimento por conta". Um reduce copiado do lugar
-- errado mostraria receita negativa.
--
-- SEM FILTRO DE CIDADE, de propósito: `financial_journals.order_id` é
-- nullable desde 20260818140000 (`check (num_nonnulls(order_id,
-- subscription_id) = 1)`) — cobrança de assinatura de profissional não tem
-- order_id, tem subscription_id. Um join com orders/jobs pra filtrar cidade
-- descartaria toda receita de assinatura via inner join. Sistema é
-- single-region hoje; revisitar se/quando isso deixar de ser verdade.

create or replace function public.obter_receita_gmv_mensal(
  p_meses integer default 12
)
returns table (mes date, receita numeric, gmv numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (select public.eh_admin()) then
    raise exception 'Acesso restrito a administradores.';
  end if;

  return query
  with meses as (
    select (date_trunc('month', now() at time zone 'utc') - (n || ' months')::interval)::date as mes_inicio
      from generate_series(0, least(60, greatest(1, coalesce(p_meses, 12))) - 1) as n
  ),
  receita_por_mes as (
    select date_trunc('month', fj.occurred_at at time zone 'utc')::date as mes_inicio,
           sum(fp.amount * case when fp.direction = 'credit' then 1 else -1 end) as receita
      from public.financial_postings fp
      join public.financial_journals fj on fj.id = fp.journal_id
     where fp.account_code in ('platform_commission', 'platform_product_margin', 'platform_subscription_revenue')
     group by 1
  ),
  gmv_por_mes as (
    select date_trunc('month', o.created_at at time zone 'utc')::date as mes_inicio,
           sum(o.total) as gmv
      from public.orders o
     where o.payment_status = 'pago'
     group by 1
  )
  select m.mes_inicio, coalesce(r.receita, 0), coalesce(g.gmv, 0)
    from meses m
    left join receita_por_mes r on r.mes_inicio = m.mes_inicio
    left join gmv_por_mes g on g.mes_inicio = m.mes_inicio
   order by m.mes_inicio;
end;
$$;

revoke all on function public.obter_receita_gmv_mensal(integer)
  from public, anon;
grant execute on function public.obter_receita_gmv_mensal(integer)
  to authenticated;

comment on function public.obter_receita_gmv_mensal(integer) is
  'Receita própria da plataforma (comissão + margem + assinatura) e GMV (orders.total pago), mês a mês, últimos p_meses meses. Admin apenas.';
