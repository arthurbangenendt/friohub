-- ============================================================================
-- Novas features de plano: PMOC, Ferramentas, Desempenho, Clientes, Oportunidades
-- ============================================================================
--
-- Mapeamento de produto (confirmado):
--   Gratuito     -> nenhuma das 5.
--   Essencial    -> pmoc, ferramentas.
--   Profissional -> as 5.
--   Master       -> as 5 (herda tudo do Profissional).
--
-- Usa `||` (merge raso de jsonb) em vez de reescrever `features` inteiro:
-- preserva as chaves já lidas por `plano_permite` (agenda, graficos,
-- custos_obra) e as não-booleanas fora do escopo deste gate (financeiro,
-- equipe) sem risco de apagar alguma por esquecimento.

update public.subscription_plans
   set features = features
                  || jsonb_build_object(
                       'pmoc', false, 'ferramentas', false,
                       'desempenho', false, 'clientes', false, 'oportunidades', false
                     )
 where slug = 'gratuito';

update public.subscription_plans
   set features = features
                  || jsonb_build_object(
                       'pmoc', true, 'ferramentas', true,
                       'desempenho', false, 'clientes', false, 'oportunidades', false
                     )
 where slug = 'essencial';

update public.subscription_plans
   set features = features
                  || jsonb_build_object(
                       'pmoc', true, 'ferramentas', true,
                       'desempenho', true, 'clientes', true, 'oportunidades', true
                     )
 where slug in ('profissional', 'master');

comment on column public.subscription_plans.features is
  'Capacidades por plano, lidas via plano_permite(). Chaves booleanas: busca, orcamentos, agenda, custos_obra, graficos, assistente, pmoc, ferramentas, desempenho, clientes, oportunidades. Não-booleanas fora do gate: financeiro (texto), equipe (número).';
