-- ============================================================================
-- Corrige dois erros pegos por `supabase db lint --fail-on error`, ambos
-- introduzidos por migrations posteriores que mudaram algo que a função
-- original assumia, sem atualizar a função:
--
--   1. `criar_order`: `on conflict (job_id)` apontava pra constraint
--      `orders_job_unique`, removida em 20260817130000_orcamento_final_pos_visita
--      e substituída por `orders_job_origem_unique` (job_id, origem) — job
--      passou a poder ter uma order por origem. `criar_order` sempre grava
--      com o `origem` default ('aceite_quote'), então o conflict target certo
--      agora é o par (job_id, origem): mesma proteção de idempotência de
--      antes, só que escopada à origem certa.
--
--   2. `listar_assinaturas_prontas_para_renovar`: a subquery referenciava
--      `next_due_date` sem qualificar, e esse nome colide com a coluna de
--      mesmo nome do RETURNS TABLE (vira variável plpgsql implícita) —
--      "column reference is ambiguous". Corrigido dando alias à subquery e
--      qualificando as referências.
-- ============================================================================

create or replace function public.criar_order(p_job_id uuid, p_preco_servico numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job     public.jobs%rowtype;
  v_venda   numeric(10,2) := 0;
  v_custo   numeric(10,2) := 0;
  v_pct     numeric;
  v_servico numeric(10,2) := greatest(coalesce(p_preco_servico, 0), 0);
  v_id      uuid;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if not found then
    raise exception 'Serviço não encontrado.';
  end if;

  -- SECURITY DEFINER ignora RLS, então a autorização é explícita aqui.
  -- `auth.uid()` continua sendo o usuário da requisição mesmo como definer.
  if v_job.cliente_id is distinct from auth.uid() then
    raise exception 'Apenas o cliente do serviço pode gerar a ordem.';
  end if;

  if v_job.produto_id is not null then
    select p.preco_venda, p.custo into v_venda, v_custo
      from public.products p
     where p.id = v_job.produto_id;
  end if;

  select comissao_servico_pct into v_pct from public.platform_config where id;

  insert into public.orders (
    job_id, preco_produto, preco_servico, comissao_servico, margem_produto, total, payment_status
  ) values (
    p_job_id,
    coalesce(v_venda, 0),
    v_servico,
    round(v_servico * coalesce(v_pct, 0.15), 2),
    coalesce(v_venda, 0) - coalesce(v_custo, 0),
    coalesce(v_venda, 0) + v_servico,
    'pendente'
  )
  on conflict (job_id, origem) do nothing
  returning id into v_id;

  return v_id;   -- nulo quando a ordem já existia
end;
$$;

create or replace function public.listar_assinaturas_prontas_para_renovar(p_limit integer default 20)
returns table (
  subscription_id uuid, professional_id uuid, plan_id uuid,
  amount numeric, ciclo text, next_due_date date
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.plan_subscriptions ps
     set renewal_claimed_at = now()
   where ps.id in (
     select s.id from public.plan_subscriptions s
      where s.status in ('active', 'overdue')
        and s.next_due_date is not null
        and s.next_due_date <= current_date
        and (s.renewal_claimed_at is null or s.renewal_claimed_at < now() - interval '1 hour')
      order by s.next_due_date
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
      for update skip locked
   )
  returning ps.id, ps.professional_id, ps.plan_id, ps.amount, ps.ciclo, ps.next_due_date;
end;
$$;
