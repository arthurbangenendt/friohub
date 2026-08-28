// Tipos e regras puras do fluxo de solicitação.
//
// Vive fora de `actions.ts` de propósito: um módulo "use server" só pode
// exportar funções async, então helpers síncronos compartilhados entre servidor
// e cliente precisam morar aqui.

export type JobType =
  | "instalacao_com_equipamento"
  | "troca_equipamento"
  | "manutencao"
  | "remanejamento"
  | "limpeza"
  | "conserto"
  | "outros"
  /* Compra avulsa de equipamento/peça, sem pedido de orçamento nem
     profissional envolvido — ver 20260828140000_compra_avulsa.sql. Não entra
     em TIPOS_COM_CATALOGO porque não passa pelo wizard: nasce direto de
     `criar_compra_avulsa`. */
  | "compra_equipamento";

// Tipos em que o cliente pode comprar o aparelho pela plataforma. Só nesses o
// catálogo aparece e só neles pode nascer uma order com margem de produto.
const TIPOS_COM_CATALOGO: JobType[] = ["instalacao_com_equipamento", "troca_equipamento"];

export function aceitaCatalogo(t: JobType): boolean {
  return TIPOS_COM_CATALOGO.includes(t);
}

// Nome exibido do serviço. Fonte única — estava duplicado no painel e na página
// do serviço, e tipo novo entrava sem rótulo nos dois lugares.
export const JOB_LABEL: Record<JobType, string> = {
  instalacao_com_equipamento: "Instalação de ar novo",
  troca_equipamento: "Troca de equipamento",
  manutencao: "Manutenção",
  remanejamento: "Remanejamento",
  limpeza: "Limpeza",
  conserto: "Conserto",
  outros: "Outro serviço",
  compra_equipamento: "Compra de equipamento",
};

/* Especialidade avaliável correspondente ao serviço.
   `outros` é null de propósito: `reviews.specialty` e `professional_skills.specialty`
   só aceitam as cinco especialidades do CHECK, e não dá para adivinhar qual delas
   um pedido genérico exercitou. Quem consome precisa tratar o null — atribuir a
   "instalacao" por padrão credita reputação na especialidade errada. */
export const SPECIALTY_OF: Record<JobType, string | null> = {
  instalacao_com_equipamento: "instalacao",
  troca_equipamento: "instalacao",
  manutencao: "manutencao",
  remanejamento: "remanejamento",
  limpeza: "limpeza",
  conserto: "conserto",
  outros: null,
  // Sem profissional, não há o que avaliar por especialidade.
  compra_equipamento: null,
};

export function rotuloJob(t: string): string {
  return JOB_LABEL[t as JobType] ?? t;
}

// Mesmo enum de `products.categoria` no banco — ver
// 20260819100000_pedido_aparelho_conhecido.sql.
export const CATEGORIA_LABEL: Record<string, string> = {
  split: "Split", inverter: "Inverter", multi_split: "Multi Split",
  piso_teto: "Piso teto", janela: "Janela",
};
