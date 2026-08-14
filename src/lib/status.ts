/* Fonte única dos estados exibidos na interface.
 *
 * Antes cada tela declarava o próprio `Record<string, {label, cor, bg}>` — havia
 * seis mapas soltos e eles já tinham divergido de verdade: "Concluído" saía
 * #2E8B6F/#e4f3ee na lista do painel e var(--good)/var(--cool-wash) na página do
 * serviço, e "Verificado" tinha um fundo no admin e outro no perfil da
 * distribuidora. Mesmo estado, cores diferentes conforme a tela — o tipo de
 * inconsistência que o usuário não sabe nomear, mas sente como desleixo.
 *
 * A cor não é escolhida por estado, e sim por TOM. Assim um estado novo só
 * precisa responder "isso é bom, ruim, em andamento ou espera?" — e nasce
 * coerente com o resto do produto, inclusive no modo escuro.
 */

export type Tom = "neutro" | "espera" | "andamento" | "sucesso" | "erro";

export const TOM: Record<Tom, { cor: string; bg: string }> = {
  /* Ainda não começou / não depende de ninguém agora. */
  neutro: { cor: "var(--ink-soft)", bg: "var(--surface-2)" },
  /* Parado esperando ação de alguém — é o tom que pede atenção. */
  espera: { cor: "var(--warm)", bg: "var(--warm-wash)" },
  /* Andando, dentro do esperado. */
  andamento: { cor: "var(--cool-deep)", bg: "var(--cool-wash)" },
  sucesso: { cor: "var(--good)", bg: "var(--good-wash)" },
  erro: { cor: "var(--danger)", bg: "var(--danger-wash)" },
};

export type Estado = { label: string; tom: Tom };
export type EstadoResolvido = { label: string; cor: string; bg: string };

/** `jobs.status` — o serviço em si. */
export const STATUS_JOB: Record<string, Estado> = {
  aberto: { label: "Aberto", tom: "neutro" },
  aguardando_profissional: { label: "Aguardando profissional", tom: "espera" },
  aceito: { label: "Aceito", tom: "andamento" },
  em_execucao: { label: "Em execução", tom: "andamento" },
  concluido: { label: "Concluído", tom: "sucesso" },
  avaliado: { label: "Avaliado", tom: "sucesso" },
  cancelado: { label: "Cancelado", tom: "erro" },
};

/** `quote_requests.status` — o pedido de orçamento. */
export const STATUS_PEDIDO: Record<string, Estado> = {
  aberto: { label: "Aguardando propostas", tom: "espera" },
  fechado: { label: "Fechado", tom: "sucesso" },
  cancelado: { label: "Cancelado", tom: "erro" },
  expirado: { label: "Expirado", tom: "neutro" },
};

/** `purchase_orders.status` — o repasse para a distribuidora. */
export const STATUS_REPASSE: Record<string, Estado> = {
  a_repassar: { label: "A repassar", tom: "espera" },
  confirmado: { label: "Confirmado", tom: "andamento" },
  faturado: { label: "Faturado", tom: "andamento" },
  enviado: { label: "Enviado", tom: "andamento" },
  entregue: { label: "Entregue", tom: "sucesso" },
  cancelado: { label: "Cancelado", tom: "erro" },
};

/** `professionals.verification_status` / `distributors.verification_status`. */
export const STATUS_VERIFICACAO: Record<string, Estado> = {
  pendente: { label: "Pendente", tom: "espera" },
  em_analise: { label: "Em análise", tom: "espera" },
  verificado: { label: "Verificado", tom: "sucesso" },
  rejeitado: { label: "Rejeitado", tom: "erro" },
};

/** `orders.payment_status`. */
export const STATUS_PAGAMENTO: Record<string, Estado> = {
  pendente: { label: "Pendente", tom: "espera" },
  pago: { label: "Pago", tom: "sucesso" },
  reembolsado: { label: "Reembolsado", tom: "neutro" },
  falhou: { label: "Falhou", tom: "erro" },
};

/* Status vindo do banco é texto livre do ponto de vista do front. Um valor
   desconhecido não pode derrubar a tela nem sumir: cai em neutro exibindo a
   própria chave, que é informação suficiente para alguém investigar. */
export function resolver(mapa: Record<string, Estado>, chave: string | null | undefined): EstadoResolvido {
  const e = (chave && mapa[chave]) || { label: chave ?? "—", tom: "neutro" as const };
  return { label: e.label, ...TOM[e.tom] };
}

/** Converte um mapa inteiro para a forma resolvida — ponte para o código que
 *  ainda consome `STATUS[chave].cor` diretamente. */
export function resolverMapa(mapa: Record<string, Estado>): Record<string, EstadoResolvido> {
  return Object.fromEntries(
    Object.entries(mapa).map(([k, e]) => [k, { label: e.label, ...TOM[e.tom] }]),
  );
}
