-- ============================================================================
-- Flag de rollout do Chatwoot
--
-- Mesmo desenho de `asaas_payments`: nasce desligada, com rollout zero, por
-- região. Nada do que as migrations anteriores criaram tem efeito sobre o
-- usuário enquanto esta chave não virar — as tabelas existem, os workers podem
-- estar no ar, e o app continua usando o chat interno como sempre.
--
-- O que a flag governa, do lado do app:
--   · `enviarMensagem()` escrever via Chatwoot em vez de INSERT direto;
--   · a tela de mensagens mostrar canal, status e transferência;
--   · o widget subir identificado.
--
-- O que ela NÃO governa: o webhook de entrada. Se o Chatwoot já está entregando
-- evento, espelhar é sempre correto — o espelho é read-only para o usuário e
-- desligar a flag no meio de uma conversa não deve fazer mensagem sumir.
--
-- Rollout por profissional: `feature_enabled` já sorteia por `p_subject_id`, e é
-- assim que a verificação ponta a ponta liga um técnico de teste sem expor
-- todo mundo.
-- ============================================================================

insert into public.feature_flags (flag_key, region_id, description, enabled, rollout_percentage)
select f.flag_key, r.id, f.description, f.enabled, f.rollout
  from public.marketplace_regions r
 cross join (values
   ('chatwoot_messaging', 'Conversas omnichannel pelo Chatwoot', false, 0)
 ) as f(flag_key, description, enabled, rollout)
 where r.slug = 'sao-paulo-sp'
   and not exists (
     select 1 from public.feature_flags ff
      where ff.flag_key = f.flag_key and ff.region_id = r.id
   );
