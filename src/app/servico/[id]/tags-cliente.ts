// Vocabulário fechado da avaliação de cliente.
//
// Fica fora de actions.ts porque módulo "use server" só exporta função async.
// O mesmo conjunto está no CHECK de `client_reviews.tags`: valor fora da lista
// é barrado no banco mesmo que passe pela aplicação.
//
// Tags são fatos verificáveis, nunca julgamento de pessoa. "Remarcou várias
// vezes" é informação operacional; "cliente chato" seria ofensa registrada.
export const TAGS_CLIENTE = [
  { id: "pagou_em_dia", label: "Pagou em dia", bom: true },
  { id: "ambiente_preparado", label: "Ambiente preparado", bom: true },
  { id: "comunicacao_clara", label: "Comunicação clara", bom: true },
  { id: "horario_respeitado", label: "Respeitou o horário", bom: true },
  { id: "remarcou_varias_vezes", label: "Remarcou várias vezes", bom: false },
  { id: "ambiente_sem_acesso", label: "Ambiente sem acesso", bom: false },
  { id: "demorou_a_responder", label: "Demorou a responder", bom: false },
  { id: "escopo_mudou", label: "Escopo mudou na hora", bom: false },
] as const;

export const TAG_IDS: readonly string[] = TAGS_CLIENTE.map((t) => t.id);
export const TAG_LABEL: Record<string, string> =
  Object.fromEntries(TAGS_CLIENTE.map((t) => [t.id, t.label]));
