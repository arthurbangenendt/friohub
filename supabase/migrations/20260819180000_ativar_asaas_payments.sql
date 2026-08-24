-- ============================================================================
-- Ativa a cobrança real do cliente pelo serviço (asaas_payments)
-- ============================================================================
--
-- Pré-requisitos resolvidos antes desta migration:
--   - obter_checkout_cobranca já devolve `amount` (20260818155000).
--   - preparar_cobranca_order já divide o repasse corretamente entre 2+
--     distribuidoras do mesmo pedido (20260819170000).
--   - Coleta de CPF/CNPJ do cliente no aceite de proposta já existe
--     (20260819150000, Propostas.tsx) e agora valida dígito verificador.
--
-- `marketplace_regions` hoje só tem 'sao-paulo-sp' cadastrada — ativar aqui é
-- ativar em todas as cidades operando no produto hoje. Uma região nova que
-- entrar depois nasce sem flag própria e cai no `false` padrão de
-- `feature_enabled` (nenhuma linha resolvida) até alguém configurar a flag
-- para ela.
--
-- `configurar_feature_flag` exige um admin autenticado (`auth.uid()`) — não
-- dá pra chamar de dentro de uma migration, que roda sem sessão de usuário.
-- Update direto na tabela, mesmo padrão de 20260818145000 (city_billing_config).
update public.feature_flags ff
   set enabled = true, rollout_percentage = 100
  from public.marketplace_regions mr
 where ff.region_id = mr.id
   and ff.flag_key = 'asaas_payments'
   and mr.slug = 'sao-paulo-sp';

insert into public.admin_audit_log (actor_id, action, entity_type, entity_id, old_values, new_values, reason)
select null, 'feature_flag_changed', 'feature_flag', ff.id,
       jsonb_build_object('enabled', false, 'rollout_percentage', 0),
       jsonb_build_object('enabled', true, 'rollout_percentage', 100),
       'Migration 20260819180000: bugs de valor/repasse corrigidos, CPF/CNPJ coletado no aceite. Ativação em produção.'
  from public.feature_flags ff
  join public.marketplace_regions mr on mr.id = ff.region_id
 where ff.flag_key = 'asaas_payments' and mr.slug = 'sao-paulo-sp';
