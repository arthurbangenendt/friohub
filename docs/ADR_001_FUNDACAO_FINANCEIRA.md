# ADR 001 — Fundação financeira independente do gateway

- Status: aceito para fundação local
- Data: 13/08/2026
- Gateway previsto: Asaas

## Contexto

O FrioHub já possuía `orders`, preço, comissão, margem e um `payment_status`. Essa linha representa
o acordo comercial, mas não consegue explicar tentativas de cobrança, webhooks duplicados,
liquidação, reembolso, chargeback ou repasse. Usar o status do serviço como evidência de receita
também fazia a interface chamar de recebido um valor que nunca entrou.

O nome comercial, domínio, credenciais e política de repasse ainda não foram definidos. Portanto,
esta decisão cobre somente a fonte de verdade interna e não autoriza movimentação real.

## Decisão

1. `orders` continua sendo o contrato comercial e uma projeção de compatibilidade.
2. Cada tentativa efetiva é uma `payment_charge`, com valor congelado e chave de idempotência.
3. A distribuição econômica é congelada em `payment_allocations` antes de chamar o gateway.
4. Todo webhook é primeiro persistido em `payment_gateway_events`; depois é processado.
5. Dinheiro liquidado é registrado em ledger de partidas dobradas, nunca inferido do job.
6. Lançamentos e partidas são imutáveis. Correções usam outro diário de reversão.
7. `PAYMENT_CONFIRMED` não significa liquidação; apenas `PAYMENT_RECEIVED` gera receita/obrigações.
8. Eventos duplicados e fora de ordem não podem duplicar nem regredir estado financeiro.
9. Reembolso integral reverte o diário original. Reembolso parcial fica bloqueado até aprovação
   da política de alocação entre profissional, distribuidora e plataforma.
10. A reconciliação interna identifica projeção sem ledger, valor divergente, evento travado,
    reembolso parcial e disputa.

## Consequências

- A futura Edge Function do Asaas terá uma superfície pequena: criar/vincular cobrança e
  autenticar/registrar evento.
- O segredo do gateway jamais entra no browser ou no banco público.
- Reprocessar webhook é seguro e auditável.
- O painel financeiro só trata `payment_status = pago` como valor liquidado.
- A integração real permanece bloqueada até política de cancelamento, chargeback, repasse e
  KYC/KYB serem aprovadas e testadas no sandbox.

## Alternativas rejeitadas

- Atualizar somente `orders.payment_status`: não preserva eventos nem explica saldo.
- Vincular pagamento ao status do job: execução operacional e liquidação financeira são fatos
  independentes.
- Split imediato por padrão: o Asaas executa o split ao receber, enquanto o marketplace pode
  precisar esperar conclusão, garantia ou resolução de disputa.
