# SLOs de operação — piloto FrioHub

Atualizado em 13/08/2026. Estes números são metas para o piloto, não desempenho histórico de
produção. O erro orçamentário só começa a ser calculado após monitor externo estar ativo.

| Jornada | Indicador | Meta mensal | Janela rápida |
|---|---|---:|---:|
| Catálogo e matching | requisições válidas sem 5xx | 99,5% | p95 ≤ 500 ms |
| Criar pedido/proposta | operações concluídas sem erro interno | 99,5% | p95 ≤ 800 ms |
| Chat | mensagens aceitas e persistidas | 99,5% | p95 ≤ 500 ms |
| Health/readiness | disponibilidade do endpoint | 99,9% | p95 ≤ 250 ms |
| Webhook Asaas | eventos persistidos antes do processamento | 99,9% quando ativado | p95 ≤ 1 s |
| Notificações externas | eventos entregues ou em retry | 95% em 5 min quando o worker existir | — |

## Error budget e rollout

- 99,5% permite cerca de 3 h 39 min de indisponibilidade em 30 dias.
- Consumir 50% do budget antes da metade do mês congela rollout não essencial.
- Consumir 100% congela lançamento e exige correção da causa antes de nova praça.
- Feature nova inicia em `internal`, passa a `pilot` e só chega a 100% após smoke, métricas e
  ausência de regressão no período acordado.

## Detecção existente

`avaliar_saude_sistema()` roda a cada cinco minutos e registra banco, outbox, webhooks financeiros,
reconciliação, SLA do marketplace e visitas PMOC. `/api/health` expõe apenas status e horário;
snapshot com mais de dez minutos vira `down`. Detalhes são restritos ao admin.

Isso ainda não satisfaz o SLO sozinho: uma falha total do provedor não consegue alertar a partir do
próprio provedor. Antes de produção é obrigatório configurar monitor externo em outra infraestrutura
e encaminhar alertas para pessoas responsáveis.

## Evidência local de 13/08/2026

- PostgreSQL: 169.724 transações de leitura em 10 s, 0 falhas, média 0,585 ms, 10 clientes.
- HTTP `/api/health`: 28.752 requisições em 10 s, 0 erros, p95 5,1 ms, concorrência 10.

São testes locais com base vazia, sem latência de internet e sem tráfego misto. Servem como baseline
de regressão, não como estimativa de capacidade de produção.

