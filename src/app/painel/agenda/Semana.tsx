import Link from "next/link";
import { JOB_LABEL, type JobType } from "@/app/solicitar/tipos";
import { diaDaSemanaCurto, hojeISO, hora } from "./tempo";
import { mono } from "../shared";

export type ItemSemana = {
  id: string;
  job_id: string;
  starts_at: string;
  status: string;
  job_type: string | null;
  cliente: string | null;
  dia: string;
};

/* Visão de semana.
 *
 * Colunas, e não uma grade de horas: a agenda de campo tem dois ou três
 * atendimentos por dia, e uma régua das 6h às 20h ficaria 90% vazia — o que
 * esconde a informação que importa (quais dias estão livres) atrás de rolagem.
 *
 * `auto-fit` com mínimo de 150px faz as sete colunas virarem duas ou três no
 * celular, sem media query e sem rolagem horizontal às cegas. */
export function Semana({ dias, itens }: { dias: string[]; itens: ItemSemana[] }) {
  const hoje = hojeISO();
  const porDia = new Map<string, ItemSemana[]>();
  for (const i of itens) {
    const lista = porDia.get(i.dia) ?? [];
    lista.push(i);
    porDia.set(i.dia, lista);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 22 }}>
      {dias.map((dia) => {
        const doDia = (porDia.get(dia) ?? []).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
        const ehHoje = dia === hoje;
        return (
          <section
            key={dia}
            aria-label={`${diaDaSemanaCurto(dia)}, ${dia.slice(8)}`}
            style={{
              display: "flex", flexDirection: "column", gap: 6,
              padding: 12, borderRadius: 13, minHeight: 130,
              background: "var(--surface)",
              border: `1px solid ${ehHoje ? "var(--cool)" : "var(--line)"}`,
            }}
          >
            {/* O cabeçalho leva para o dia: a semana serve para escolher onde
                olhar, o detalhe continua na visão diária. */}
            <Link href={`/painel/agenda?d=${dia}`} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 10.5, fontFamily: mono, textTransform: "uppercase", letterSpacing: "0.06em", color: ehHoje ? "var(--cool-deep)" : "var(--ink-faint)" }}>
                {diaDaSemanaCurto(dia)}
              </span>
              <span style={{ fontSize: 15, fontWeight: 800, color: ehHoje ? "var(--cool-deep)" : "var(--ink)" }}>
                {dia.slice(8)}
              </span>
            </Link>

            {doDia.length === 0 ? (
              <span style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 4 }}>Livre</span>
            ) : (
              doDia.map((i) => (
                <Link
                  key={i.id}
                  href={`/servico/${i.job_id}`}
                  style={{
                    display: "grid", gap: 1, padding: "7px 9px", borderRadius: 9,
                    background: "var(--bg-subtle)",
                    borderLeft: `3px solid ${i.status === "proposed" ? "var(--warm)" : "var(--cool)"}`,
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{hora(i.starts_at)}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {i.job_type ? (JOB_LABEL[i.job_type as JobType] ?? i.job_type) : "Serviço"}
                  </span>
                  {i.cliente && (
                    <span style={{ fontSize: 11.5, color: "var(--ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {i.cliente}
                    </span>
                  )}
                </Link>
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}
