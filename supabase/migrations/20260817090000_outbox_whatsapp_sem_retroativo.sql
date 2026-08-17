-- ============================================================================
-- Correção: o canal WhatsApp não pode nascer com fila acumulada
--
-- 20260815093000 adicionou `notification_outbox.whatsapp_allowed` com
-- `default true`. Isso está certo para linha nova e ERRADO para linha antiga:
-- o default preencheu retroativamente tudo que já estava na tabela, inclusive
-- notificações enfileiradas dias antes de o canal existir.
--
-- O efeito prático seria ruim e visível: `notification_outbox` acumulou eventos
-- desde que foi criada, porque nunca teve consumidor nenhum. No minuto em que a
-- inbox de WhatsApp for configurada, o worker reservaria esse acúmulo inteiro e
-- dispararia — a pessoa receberia "Você recebeu uma proposta" e "Novo horário
-- proposto" sobre coisas de dias atrás, algumas já resolvidas. Primeira
-- impressão do canal seria um flood de mensagem velha.
--
-- A coluna diz "preferência no instante do enfileiramento". Para quem foi
-- enfileirado antes do canal existir, não havia preferência a congelar — e
-- assumir `true` é inventar um consentimento que ninguém deu. `false` é a
-- leitura honesta.
--
-- Não mexe em `inapp_allowed` nem em `email_allowed`: o inbox do app já mostrou
-- essas notificações, e o canal de e-mail continua sem consumidor.
--
-- Reversibilidade: é um UPDATE em linhas passadas. Desfazer é possível, mas não
-- faria sentido — o motivo de existir é justamente não entregar o passado.
-- ============================================================================

update public.notification_outbox
   set whatsapp_allowed = false
 where whatsapp_allowed
   and status in ('pending', 'failed')
   and created_at < now();

comment on column public.notification_outbox.whatsapp_allowed is
  'Preferência de WhatsApp no instante do enfileiramento. Congelada: mudar a preferência não reescreve o passado. O consumidor DEVE filtrar por ela. Linhas anteriores à criação do canal foram marcadas false em 20260817090000 — não havia preferência a congelar.';
