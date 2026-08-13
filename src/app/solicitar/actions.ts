"use server";

/* A criação direta de job saiu daqui.
 *
 * Antes, `criarSolicitacao` gravava o job na hora em que o cliente escolhia um
 * profissional — e só criava `orders` quando havia produto, deixando manutenção,
 * limpeza, conserto e remanejamento sem preço e sem comissão.
 *
 * Agora todo serviço nasce como PEDIDO DE ORÇAMENTO: o cliente descreve uma vez,
 * envia para vários profissionais, e o job só existe quando ele aceita uma
 * proposta — já com preço e com a comissão da plataforma. Ver
 * `painel/orcamentos/actions.ts` e a função `aceitar_quote` em
 * 20260812240000_orcamentos.sql.
 *
 * Manter aqui um server action que cria job direto seria manter um caminho
 * paralelo que fura o funil e nasce sem preço — por isso ele foi removido, e não
 * apenas deixado de lado.
 *
 * O arquivo permanece porque `JobType` é reexportado a partir dele em vários
 * pontos do wizard.
 */

export type { JobType } from "./tipos";
