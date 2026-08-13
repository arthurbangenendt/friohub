# ADR 003 — PMOC recorrente sem cobrança automática

- Status: aceito
- Data: 13/08/2026

## Contexto

Clientes comerciais precisam controlar manutenções periódicas, enquanto o marketplace ainda não
possui contrato jurídico, emissão de documento técnico ou cobrança Asaas ativa. Misturar essas
responsabilidades agora criaria uma aparência de conformidade e receita que o produto não entrega.

## Decisão

O FrioHub passa a organizar solicitação, atribuição administrativa, aceite com preço por visita,
agenda recorrente, conclusão e cancelamento de PMOC. Apenas profissionais verificados, com tag
`pmoc` e cobertura do CEP podem receber uma oferta. Transições ocorrem por RPC; eventos são
imutáveis e visitas futuras são geradas por worker idempotente.

A feature flag `pmoc` controla o rollout por praça. Nenhuma cobrança, repasse, laudo, assinatura
técnica ou obrigação legal é inferida pelo estado `active`.

## Consequências

- Cliente, profissional e admin têm fluxo operacional completo no painel.
- Preço acordado por visita é registrado, mas não cobrado automaticamente.
- A ativação comercial exige política contratual, escopo do documento, responsável técnico,
  integração Asaas e tratamento de cancelamento/disputa.
- O cron diário cria visitas dentro da janela de 30 dias sem duplicá-las.

