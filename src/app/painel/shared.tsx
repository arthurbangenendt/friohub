import Link from "next/link";
import type { CSSProperties } from "react";
import { formatarBRL } from "@/lib/pricing";
import { rotuloJob } from "../solicitar/tipos";
import { MapPin } from "@/components/icons";
import { STATUS_JOB, resolverMapa } from "@/lib/status";
import { one } from "@/lib/relacional";

export const mono = "var(--font-geist-mono), ui-monospace, monospace";

/** Reexportado de `@/lib/status` para não quebrar quem já importa daqui. */
export const STATUS = resolverMapa(STATUS_JOB);

// `aberto` entra em ativos: é job sem profissional designado, que ainda depende
// de alguém agir.
export const ATIVOS = ["aberto", "aguardando_profissional", "aceito", "em_execucao"];
export const FECHADOS = ["concluido", "avaliado"];

export type Filtro = "ativos" | "concluidos" | "todos";
export const FILTROS: { id: Filtro; label: string }[] = [
  { id: "ativos", label: "Em andamento" },
  { id: "concluidos", label: "Concluídos" },
  { id: "todos", label: "Todos" },
];

export type JobRow = {
  id: string;
  job_type: string;
  status: string;
  created_at: string;
  ambiente: string | null;
  cep: string | null;
  endereco: string | null;
  btu_recomendado: number | null;
  produto: unknown;
  profissional: unknown;
  cliente: unknown;
};

export type OrderRow = {
  preco_servico: number;
  comissao_servico?: number;
  total: number;
  payment_status: string;
};

export { one };

export const dataCurta = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

export function Kpi({ label, valor, sufixo, icone }: { label: string; valor: string; sufixo?: string; icone?: React.ReactNode }) {
  return (
    <div style={{ padding: "16px 18px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--line)" }}>
      <div style={{ fontSize: 11.5, fontFamily: mono, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-faint)" }}>{label}</div>
      <div style={{ fontSize: "1.45rem", fontWeight: 800, letterSpacing: "-0.02em", marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
        {icone && <span style={{ color: "var(--warm)", display: "flex" }}>{icone}</span>}
        {valor}
      </div>
      {sufixo && <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 2 }}>{sufixo}</div>}
    </div>
  );
}

export function Cabecalho({ eyebrow, titulo }: { eyebrow: string; titulo: string }) {
  return (
    <div>
      <p style={{ fontFamily: mono, fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--cool)", margin: "0 0 10px" }}>{eyebrow}</p>
      <h1 style={{ fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-0.025em", margin: 0 }}>{titulo}</h1>
    </div>
  );
}

/* Lista de serviços com abas por status. Compartilhada entre os dois painéis —
   o que muda é o rótulo da contraparte e qual valor é exibido (líquido para o
   profissional, total para o cliente). */
export function ListaJobs({
  titulo, jobs, ativos, concluidos, filtro, orderPorJob, isPro, vazio,
}: {
  titulo: string;
  jobs: JobRow[];
  ativos: JobRow[];
  concluidos: JobRow[];
  filtro: Filtro;
  orderPorJob: Map<string, OrderRow>;
  isPro: boolean;
  vazio: Record<Filtro, string>;
}) {
  const lista = filtro === "ativos" ? ativos : filtro === "concluidos" ? concluidos : jobs;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", margin: "36px 0 14px" }}>
        <h2 style={{ fontSize: "1.15rem", fontWeight: 700, letterSpacing: "-0.01em", margin: 0 }}>{titulo}</h2>
        <div style={{ display: "flex", gap: 6 }}>
          {FILTROS.map((f) => {
            const n = f.id === "ativos" ? ativos.length : f.id === "concluidos" ? concluidos.length : jobs.length;
            const on = f.id === filtro;
            return (
              <Link key={f.id} href={`/painel?f=${f.id}`} style={{
                fontSize: 13, fontWeight: 600, padding: "6px 12px", borderRadius: 100, textDecoration: "none",
                border: "1px solid var(--line)",
                background: on ? "var(--cool)" : "var(--surface)",
                color: on ? "#fff" : "var(--ink-soft)",
              }}>{f.label} ({n})</Link>
            );
          })}
        </div>
      </div>

      {lista.length === 0 ? (
        <div style={{ padding: "28px 24px", borderRadius: 14, background: "var(--surface)", border: "1px dashed var(--line)", color: "var(--ink-faint)", textAlign: "center", fontSize: 14 }}>
          {vazio[filtro]}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {lista.map((j) => {
            const prod = one(j.produto) as { marca: string; modelo: string } | null;
            const proObj = one(j.profissional) as { profiles: unknown } | null;
            const proPerfil = proObj && (one(proObj.profiles) as { nome: string } | null);
            const cliObj = one(j.cliente) as { nome: string } | null;
            const st = STATUS[j.status] ?? STATUS.aberto;
            const outraParte = isPro ? cliObj?.nome : proPerfil?.nome;
            const o = orderPorJob.get(j.id);
            const valor = isPro
              ? (o ? o.preco_servico - (o.comissao_servico ?? 0) : null)
              : (o ? o.total : null);

            return (
              <Link key={j.id} href={`/servico/${j.id}`} style={cardJob}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{rotuloJob(j.job_type)}</span>
                    <span style={{ fontSize: 11.5, fontFamily: mono, color: "var(--ink-faint)" }}>{dataCurta(j.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink-faint)", marginTop: 3 }}>
                    {outraParte ? `${isPro ? "Cliente" : "Profissional"}: ${outraParte}` : "Sem profissional designado"}
                    {prod ? ` · ${prod.marca} ${prod.modelo}` : ""}
                    {j.ambiente ? ` · ${j.ambiente}` : ""}
                  </div>
                  {(j.endereco || j.cep) && (
                    <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}>
                      <MapPin size={13} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {[j.endereco, j.cep].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontFamily: mono, padding: "5px 11px", borderRadius: 100, background: st.bg, color: st.cor, whiteSpace: "nowrap" }}>{st.label}</span>
                  {valor !== null && (
                    <span style={{ fontSize: 14, fontWeight: 700 }}>
                      {formatarBRL(valor)}
                      {isPro && <span style={{ fontSize: 11, fontWeight: 500, color: "var(--ink-faint)" }}> líquido</span>}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

export const wrap: CSSProperties = { maxWidth: 900, margin: "0 auto", padding: "40px 28px 80px" };
const cardJob: CSSProperties = {
  display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", borderRadius: 14,
  background: "var(--surface)", border: "1px solid var(--line)", color: "inherit", textDecoration: "none",
};
