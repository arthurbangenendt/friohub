import Link from "next/link";
import { formatarBRL } from "@/lib/pricing";
import { ArrowRight } from "@/components/icons";
import { ATIVOS, FECHADOS, Cabecalho, Kpi, ListaJobs, wrap, type Filtro, type JobRow, type OrderRow } from "./shared";
import { CentralAcoesCliente, type AcaoCentral } from "./CentralAcoes";

export function PainelCliente({
  nome, jobs, orderPorJob, filtro, acoes,
}: {
  nome: string;
  jobs: JobRow[];
  orderPorJob: Map<string, OrderRow>;
  filtro: Filtro;
  acoes: AcaoCentral[];
}) {
  const ativos = jobs.filter((j) => ATIVOS.includes(j.status));
  const concluidos = jobs.filter((j) => FECHADOS.includes(j.status));
  const totalContratado = jobs.reduce((s, j) => s + (orderPorJob.get(j.id)?.total ?? 0), 0);

  return (
    <div style={wrap}>
      <Cabecalho eyebrow="Painel" titulo={`Olá, ${nome}`} />

      <CentralAcoesCliente acoes={acoes} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginTop: 22 }}>
        <Kpi label="Em andamento" valor={String(ativos.length)} />
        <Kpi label="Concluídos" valor={String(concluidos.length)} />
        <Kpi label="Total contratado" valor={formatarBRL(totalContratado)} />
      </div>

      <Link href="/solicitar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 16, padding: "22px 24px", borderRadius: 16, background: "var(--cool)", color: "#fff", textDecoration: "none" }}>
        <div>
          <div style={{ fontSize: "1.15rem", fontWeight: 700 }}>Precisa de um serviço?</div>
          <div style={{ fontSize: 14, opacity: 0.9 }}>Instalação, manutenção, limpeza e mais.</div>
        </div>
        <span style={{ display: "flex" }}><ArrowRight size={20} /></span>
      </Link>

      <ListaJobs
        titulo="Seus pedidos"
        jobs={jobs} ativos={ativos} concluidos={concluidos}
        filtro={filtro} orderPorJob={orderPorJob} isPro={false}
        vazio={{
          ativos: "Nenhum pedido em andamento.",
          concluidos: "Nenhum serviço concluído ainda.",
          todos: "Você ainda não fez nenhum pedido.",
        }}
      />
    </div>
  );
}
