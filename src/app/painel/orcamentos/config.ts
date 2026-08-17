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

/** Teto de ambientes por pedido.
 *
 *  Um pedido carrega N cômodos para o cliente climatizar a casa inteira de uma
 *  vez. Sem teto, uma lista gigante vira algo que ninguém lê no celular e o
 *  pedido morre sem proposta. Vinte cobre casa, escritório e andar de prédio.
 *  O mesmo limite é imposto no banco por trigger — ver
 *  20260817120000_pedido_multi_ambiente.sql. */
export const MAX_AMBIENTES = 20;
