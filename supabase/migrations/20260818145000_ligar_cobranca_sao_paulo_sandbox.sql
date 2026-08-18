-- ============================================================================
-- Liga o kill switch de cobrança em São Paulo — teste de sandbox do Asaas
-- ============================================================================
--
-- Decisão do time (18/08/2026): não há profissional real cadastrado em São
-- Paulo ainda, e a chave do Asaas em uso é de sandbox (ASAAS_ENV=sandbox) —
-- nenhuma cobrança gerada por este flag movimenta dinheiro de verdade. Ligado
-- especificamente para validar o ciclo assinar → pagar → webhook → liquidar
-- ponta a ponta antes de decidir quando abrir cobrança de verdade.

update public.city_billing_config
   set cobranca_ativa = true
 where cidade = 'São Paulo';
