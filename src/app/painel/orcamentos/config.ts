/* Constantes do fluxo de orçamento.
 *
 * Vive fora de `actions.ts` por obrigação do Next: um módulo "use server" só
 * pode exportar funções async — uma const exportada de lá derruba o build
 * inteiro do módulo. Mesmo motivo pelo qual `solicitar/tipos.ts` existe.
 */

/** Teto de destinatários por pedido de orçamento.
 *
 *  Mais que isso vira spam para a rede e paralisa o cliente na comparação. Cinco
 *  é o suficiente para haver concorrência real sem que o profissional sinta que
 *  está respondendo em vão. */
export const MAX_DESTINATARIOS = 5;
