/* Fuso da agenda.
 *
 * O servidor roda em UTC. Uma agenda de campo renderizada em UTC manda o
 * técnico três horas errado — é o tipo de bug que só aparece na rua, com o
 * cliente esperando. Por isso toda conversão de dia e de hora desta tela passa
 * por aqui, e nenhuma usa `toLocaleString` sem `timeZone`.
 *
 * O Brasil não tem horário de verão desde 2019, então o deslocamento é fixo em
 * −03:00 para São Paulo. Se o horário de verão voltar, `LIMITE_DIA` é a única
 * linha que precisa mudar — passa a exigir cálculo por `Intl` em vez de sufixo
 * literal. */

export const FUSO = "America/Sao_Paulo";
const DESLOCAMENTO = "-03:00";

/** Início e fim de um dia civil de São Paulo, em instantes UTC — o formato que
 *  a coluna `timestamptz` compara. */
export function LIMITE_DIA(dia: string): { inicio: string; fim: string } {
  const inicio = new Date(`${dia}T00:00:00${DESLOCAMENTO}`);
  const fim = new Date(`${dia}T23:59:59.999${DESLOCAMENTO}`);
  return { inicio: inicio.toISOString(), fim: fim.toISOString() };
}

/** Data de hoje em São Paulo no formato YYYY-MM-DD, independente de onde o
 *  processo roda. `en-CA` é o atalho confiável para ISO curto. */
export function hojeISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date());
}

export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00${DESLOCAMENTO}`); // meio-dia evita virada de fuso
  d.setUTCDate(d.getUTCDate() + n);
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(d);
}

export const hora = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );

export const diaPorExtenso = (dia: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(new Date(`${dia}T12:00:00${DESLOCAMENTO}`));

export const diaCurto = (dia: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" }).format(
    new Date(`${dia}T12:00:00${DESLOCAMENTO}`),
  );

/** Rótulo relativo. Datar tudo por extenso cansa; "Hoje" e "Amanhã" são o que
 *  o técnico procura primeiro. */
export function rotuloRelativo(dia: string): string {
  const h = hojeISO();
  if (dia === h) return "Hoje";
  if (dia === somarDias(h, 1)) return "Amanhã";
  if (dia === somarDias(h, -1)) return "Ontem";
  return diaPorExtenso(dia);
}

/** Segunda-feira da semana que contém `dia`.
 *
 *  A semana de trabalho brasileira começa na segunda, não no domingo — o
 *  `getUTCDay()` do JavaScript devolve 0 para domingo, então o ajuste
 *  transforma domingo em 7 para ele cair no fim da semana, e não no começo. */
export function inicioDaSemana(dia: string): string {
  const d = new Date(`${dia}T12:00:00${DESLOCAMENTO}`);
  const diaDaSemana = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return somarDias(dia, 1 - diaDaSemana);
}

/** Os sete dias da semana que contém `dia`, de segunda a domingo. */
export function diasDaSemana(dia: string): string[] {
  const seg = inicioDaSemana(dia);
  return Array.from({ length: 7 }, (_, i) => somarDias(seg, i));
}

/** "6 a 12 de out" / "29 de set a 5 de out" — encurta quando o mês é o mesmo. */
export function rotuloSemana(dia: string): string {
  const dias = diasDaSemana(dia);
  const fmt = (d: string, comMes: boolean) =>
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: FUSO, day: "numeric", ...(comMes ? { month: "short" } : {}),
    }).format(new Date(`${d}T12:00:00${DESLOCAMENTO}`));
  const mesmoMes = dias[0].slice(0, 7) === dias[6].slice(0, 7);
  return `${fmt(dias[0], !mesmoMes)} a ${fmt(dias[6], true)}`;
}

export const diaDaSemanaCurto = (dia: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "short" })
    .format(new Date(`${dia}T12:00:00${DESLOCAMENTO}`))
    .replace(".", "");

/** Duração legível a partir de dois instantes. */
export function duracao(inicio: string, fim: string): string {
  const min = Math.round((new Date(fim).getTime() - new Date(inicio).getTime()) / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}
