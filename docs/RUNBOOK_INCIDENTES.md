# Runbook de incidentes

## Classificação

| Nível | Exemplo | Resposta inicial alvo |
|---|---|---:|
| SEV-1 | perda/corrupção de dados, cobrança incorreta, indisponibilidade total | 15 min |
| SEV-2 | jornada crítica degradada, fila parada, praça sem matching | 30 min |
| SEV-3 | falha parcial com alternativa operacional | próximo horário útil |

Responsáveis nominais e canal de plantão ainda precisam ser definidos antes do piloto público.

## Primeiros passos

1. Registrar horário, impacto, praça, versão e pessoa coordenadora.
2. Consultar `/api/health` e `/admin/saude`; preservar logs e IDs de correlação.
3. Interromper rollout pela feature flag afetada. Não editar saldo, preço ou status financeiro à mão.
4. Se houver risco financeiro ou de dados, bloquear novas ações da jornada e preservar evidências.
5. Escolher recuperação: retry idempotente, rollback de aplicação ou restauração validada.
6. Confirmar recuperação com smoke e acompanhar pelo menos duas janelas de health check.

## Banco indisponível ou degradado

- Confirmar disponibilidade do provedor fora da aplicação.
- Não executar reset, migration reparadora improvisada ou restore sobre a produção.
- Se a causa for migration, interromper deploy e preparar migration de correção aditiva.
- Para perda confirmada, seguir `BACKUP_RESTORE.md` em ambiente isolado antes de qualquer promoção.

## Outbox/notificações

- Verificar itens `pending/failed` antigos e `last_error` no painel/admin ou banco somente leitura.
- Corrigir provedor/worker e reprocessar pela operação idempotente; nunca marcar `sent` manualmente.
- O sistema atual ainda não tem worker externo: backlog é esperado até a escolha do provedor.

## Pagamentos/webhooks

- A Asaas permanece desativada por flag. Se ativada futuramente, pausar `asaas_payments` diante de
  assinatura inválida, divergência ou backlog.
- Nunca reenviar evento inventando ID. A inbox deduplica pelo ID original do gateway.
- Conferir reconciliação e ledger antes de comunicar pagamento, reembolso ou repasse.

## Pós-incidente

Em até dois dias úteis: linha do tempo, causa, impacto, detecção, recuperação, lacunas e ações com
dono e prazo. Incidente financeiro ou de privacidade também exige avaliação jurídica/LGPD.

