-- ============================================================================
-- Diferenciação real de features por plano
-- ============================================================================
--
-- `subscription_plans.features` (jsonb) existe desde 20260813190000 mas não
-- era lido em lugar nenhum do app — Essencial e Master davam acesso idêntico
-- a tudo. `plano_permite` é o ponto único de checagem, reaproveitado tanto em
-- Server Components (early-return, mesmo padrão de `ux_growth`/`ux_pipeline`
-- em `featureHabilitada`) quanto em RLS/RPC no futuro se algum dado sensível
-- precisar do mesmo gate.
--
-- Pagar em dia é pré-requisito, não só ter o plano certo: profissional
-- inadimplente perde acesso às features pagas mesmo sem trocar de plano —
-- mesma decisão de 20260819200000 (sumir da busca / não ser alvo de pedido).
create or replace function public.plano_permite(p_professional_id uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select (sp.features -> p_feature) = 'true'::jsonb
        from public.professionals pr
        join public.subscription_plans sp on sp.id = pr.subscription_plan_id
       where pr.id = p_professional_id
         and pr.subscription_status <> 'inadimplente'
    ),
    false
  );
$$;

revoke all on function public.plano_permite(uuid, text) from public, anon;
grant execute on function public.plano_permite(uuid, text) to authenticated;

comment on function public.plano_permite(uuid, text) is
  'Gate de feature por plano pago. Só cobre chaves booleanas de subscription_plans.features (agenda, graficos, custos_obra) — chaves não-booleanas (financeiro, equipe) não se aplicam aqui. Falso se sem plano ou inadimplente.';
