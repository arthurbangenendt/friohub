-- ============================================================================
-- Correção pontual: cidade do profissional bb1e7e03 não batia com o piloto
-- ============================================================================
--
-- "Usar minha localização" (src/lib/cep.ts) usa a API gratuita BigDataCloud
-- para reverse-geocoding. Para certas coordenadas na borda da Grande São
-- Paulo, ela não devolve `city`/`locality` e cai no fallback administrativo,
-- que retornou "Região Metropolitana de São Paulo" em vez do município —
-- string que nunca vai bater exato com `city_billing_config.cidade =
-- 'São Paulo'`. Só este profissional tem esse valor hoje (confirmado via
-- consulta pública antes desta migration); a correção é pontual e não expõe
-- cobrança a mais ninguém além do já ligado para 'São Paulo' em 20260818145000.
--
-- A causa de fundo (fallback do geocoding pode devolver região em vez de
-- cidade) continua aberta — ver 20260818148000 para a mitigação de médio
-- prazo (fallback por estado) e o time decide separadamente se vale travar
-- a lista de cidades aceitas no formulário de perfil.

update public.professionals
   set cidade = 'São Paulo'
 where id = 'bb1e7e03-467b-46c2-92cd-6885ca7d35cc'
   and cidade = 'Região Metropolitana de São Paulo';
