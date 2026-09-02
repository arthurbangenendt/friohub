-- ============================================================================
-- Liga `chatwoot_messaging` para todo o Brasil, não só São Paulo
-- ============================================================================
--
-- A flag nasceu em 0%/desligada só para `sao-paulo-sp`
-- (20260815095000_chatwoot_feature_flag.sql). Os workers que ela governa
-- (`chatwoot-dispatch`, `chatwoot-pii-sync`) já estão prontos e testados —
-- decisão do dono do produto foi ligar agora, para toda praça, atual ou
-- futura, não só a região já semeada.
--
-- `feature_flags.region_id` já suporta uma linha GLOBAL (region_id null,
-- `uq_feature_flags_global`) — `feature_enabled()` prioriza a linha
-- específica da região quando ela existe (`order by region_id nulls last`) e
-- cai na global quando não existe nenhuma linha para aquela praça. Por isso
-- esta migration faz as DUAS coisas: liga a linha que já existe para SP (para
-- não depender de qual delas o resolver escolhe hoje) E cria a linha global
-- (para uma praça nova nascer com o canal já ligado, sem exigir mais uma
-- migration).
--
-- O que continua fora do alcance desta migration, por depender de
-- infraestrutura fora do repositório: o `CHATWOOT_WHATSAPP_INBOX_ID` precisa
-- estar configurado nos secrets da Edge Function `chatwoot-dispatch`, e o
-- número de WhatsApp precisa estar de fato conectado no Chatwoot self-hosted.
-- Sem isso, `chatwoot-dispatch` continua fazendo no-op mesmo com a flag ligada
-- (ver comentário no topo da função).
-- ============================================================================

update public.feature_flags
   set enabled = true, rollout_percentage = 100
 where flag_key = 'chatwoot_messaging';

insert into public.feature_flags (flag_key, region_id, description, enabled, rollout_percentage)
select 'chatwoot_messaging', null, 'Conversas omnichannel pelo Chatwoot', true, 100
 where not exists (
   select 1 from public.feature_flags
    where flag_key = 'chatwoot_messaging' and region_id is null
 );
