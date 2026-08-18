-- ============================================================================
-- Correção pontual: upgrade do Jonathas já tinha processado antes da correção
-- ============================================================================
--
-- 20260818156000 corrigiu processar_evento_gateway para religar auto_renova
-- em upgrade, mas o evento de upgrade do Jonathas (para o Master) já tinha
-- sido processado ANTES dessa correção — a função corrigida não reprocessa
-- eventos já 'processed'. Ajuste direto no registro afetado.

update public.plan_subscriptions
   set auto_renova = true, cancelled_at = null, proximo_plano_id = null
 where professional_id = 'bb1e7e03-467b-46c2-92cd-6885ca7d35cc'
   and status = 'active'
   and auto_renova = false;
