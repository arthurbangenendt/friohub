/* Períodos do financeiro.
 *
 * A tela mostrava sempre "os últimos 6 meses", sem escolha. Quem precisa fechar
 * o mês para o contador, conferir o trimestre ou olhar o ano não tinha como —
 * e essas são exatamente as perguntas que alguém faz numa tela de financeiro.
 *
 * O corte é por mês civil, não por "últimos 30 dias": conciliação de faturamento
 * é feita em mês fechado, e uma janela deslizante não bate com nenhum extrato.
 */

export type PeriodoId = "mes" | "mes_passado" | "trimestre" | "semestre" | "ano";

export const PERIODOS: { id: PeriodoId; label: string; meses: number }[] = [
  { id: "mes", label: "Este mês", meses: 1 },
  { id: "mes_passado", label: "Mês passado", meses: 1 },
  { id: "trimestre", label: "3 meses", meses: 3 },
  { id: "semestre", label: "6 meses", meses: 6 },
  { id: "ano", label: "12 meses", meses: 12 },
];

export function comoPeriodo(v: unknown): PeriodoId {
  return typeof v === "string" && PERIODOS.some((p) => p.id === v) ? (v as PeriodoId) : "semestre";
}

export type Janela = {
  /** Primeiro instante do período, em ISO — usado nos filtros do banco. */
  inicio: string;
  /** Primeiro instante DEPOIS do período; comparar com `<` evita o problema
   *  clássico de "último dia às 23:59:59.999" perder registros. */
  fim: string;
  /** Chaves "AAAA-MM" dos meses cobertos, do mais antigo ao mais recente. */
  meses: { chave: string; label: string }[];
};

const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function janela(periodo: PeriodoId, agora = new Date()): Janela {
  const def = PERIODOS.find((p) => p.id === periodo)!;
  /* "Mês passado" é o único que não termina hoje: ele fecha no primeiro dia do
     mês corrente, senão misturaria dois meses no mesmo total. */
  const deslocamentoFim = periodo === "mes_passado" ? -1 : 0;

  const primeiroDoMesAtual = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const fimData = new Date(primeiroDoMesAtual);
  fimData.setMonth(fimData.getMonth() + 1 + deslocamentoFim);

  const inicioData = new Date(fimData);
  inicioData.setMonth(inicioData.getMonth() - def.meses);

  const meses: { chave: string; label: string }[] = [];
  const cursor = new Date(inicioData);
  while (cursor < fimData) {
    meses.push({
      chave: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
      label: MES_CURTO[cursor.getMonth()],
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return { inicio: inicioData.toISOString(), fim: fimData.toISOString(), meses };
}

/** "AAAA-MM" de um ISO — a chave usada para agrupar por mês. */
export const chaveMes = (iso: string) => iso.slice(0, 7);

/** Rótulo do período para cabeçalho e nome de arquivo exportado. */
export function rotuloPeriodo(periodo: PeriodoId): string {
  return PERIODOS.find((p) => p.id === periodo)?.label ?? "Período";
}
