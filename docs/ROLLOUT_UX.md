# FrioHub — Operação do rollout de UX

> Estado inicial local em 13/08/2026: quatro domínios ativos em 100% na praça `sao-paulo-sp`.

## Objetivo

Liberar e recuar as experiências UX 2–5 de forma determinística, regional, auditável e sem precisar
publicar uma nova versão da aplicação. Feature flags são controles de produto; autorização e
isolamento de dados continuam responsabilidade de autenticação, RLS, privilégios e RPCs.

## Domínios

| Flag | Experiência controlada |
|---|---|
| `ux_pipeline` | oportunidades, follow-up e comparação de propostas |
| `ux_execution` | modo execução e relatório técnico |
| `ux_portfolio` | equipamentos, carteira de clientes e recorrência |
| `ux_growth` | desempenho, metas e melhoria do perfil |

O mesmo usuário permanece no mesmo grupo enquanto seu UUID e o percentual não mudarem. A tela
`/admin/rollout` exige papel administrativo e registra cada mudança em `admin_audit_log`, incluindo
valores anteriores, novos valores e justificativa.

## Procedimento seguro

1. Confirmar que lint, tipos, build e contratos de banco estão verdes.
2. Alterar uma flag por vez, começando por um percentual pequeno fora da praça piloto.
3. Registrar hipótese, métrica observada e critério de rollback na justificativa.
4. Acompanhar erros, conclusão da jornada, conversão e suporte antes de aumentar o percentual.
5. Em incidente, reduzir a flag afetada e preservar evidências no log; não alterar RLS como atalho.

Para `ux_execution`, reduzir ou desativar impede novas execuções, mas rascunhos já criados continuam
disponíveis para salvar e finalizar. Isso evita abandonar técnicos durante um atendimento. Nos
outros domínios, revisar filas e jornadas ativas antes de uma desativação total.

## Limites honestos

- A configuração desta fase existe apenas no ambiente local até a migration ser aplicada no remoto.
- Rollout não substitui teste de usabilidade, telemetria consentida, suporte nem plano de incidente.
- Uma flag desativada não é uma barreira de segurança para acesso direto à API; o banco deve
  continuar seguro independentemente dela.
- O percentual define exposição, não comprova valor. Os gates do roadmap dependem de uso real.
