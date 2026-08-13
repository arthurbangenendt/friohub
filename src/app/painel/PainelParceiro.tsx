import Link from "next/link";
import { formatarBRL } from "@/lib/pricing";
import { Star } from "@/components/icons";
import { ATIVOS, FECHADOS, Cabecalho, Kpi, ListaJobs, wrap, type Filtro, type JobRow, type OrderRow } from "./shared";
import { CentralAcoesProfissional, type ResumoCentral } from "./CentralAcoes";

export function PainelParceiro({
  nome, jobs, orderPorJob, filtro, notaMedia, semPerfilPro, central,
}: {
  nome: string;
  jobs: JobRow[];
  orderPorJob: Map<string, OrderRow>;
  filtro: Filtro;
  notaMedia: number | null;
  semPerfilPro: boolean;
  central: ResumoCentral;
}) {
  const ativos = jobs.filter((j) => ATIVOS.includes(j.status));
  const concluidos = jobs.filter((j) => FECHADOS.includes(j.status));

  // Líquido dos serviços já concluídos e ainda não pagos.
  const aReceber = concluidos.reduce((s, j) => {
    const o = orderPorJob.get(j.id);
    if (!o || o.payment_status === "pago") return s;
    return s + (o.preco_servico - (o.comissao_servico ?? 0));
  }, 0);

  return (
    <div style={wrap}>
      <Cabecalho eyebrow="Painel do profissional" titulo={`Olá, ${nome}`} />

      <CentralAcoesProfissional resumo={central} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginTop: 22 }}>
        <Kpi label="Serviços ativos" valor={String(ativos.length)} />
        <Kpi label="Concluídos" valor={String(concluidos.length)} />
        <Kpi
          label="Nota média"
          valor={notaMedia === null ? "—" : notaMedia.toFixed(1)}
          sufixo={notaMedia === null ? "sem avaliações" : undefined}
          icone={notaMedia === null ? undefined : <Star size={15} filled />}
        />
        <Kpi label="A receber" valor={formatarBRL(aReceber)} sufixo="serviços concluídos não pagos" />
      </div>

      {semPerfilPro && (
        <div style={{ marginTop: 16, padding: "20px 22px", borderRadius: 14, background: "var(--warm-wash)", color: "var(--warm)" }}>
          <strong style={{ color: "var(--ink)" }}>Complete seu perfil profissional</strong>
          <p style={{ margin: "4px 0 14px", fontSize: 14, color: "var(--ink-soft)" }}>
            Para aparecer nas buscas dos clientes, cadastre suas especialidades e área de atendimento.
          </p>
          <Link href="/painel/perfil" className="btn btn-primary" style={{ height: 40, padding: "0 16px", fontSize: 14 }}>Completar perfil</Link>
        </div>
      )}

      <ListaJobs
        titulo="Serviços atribuídos a você"
        jobs={jobs} ativos={ativos} concluidos={concluidos}
        filtro={filtro} orderPorJob={orderPorJob} isPro
        vazio={{
          ativos: "Nenhum serviço em andamento. Quando um cliente te escolher, aparece aqui.",
          concluidos: "Nenhum serviço concluído ainda.",
          todos: "Nenhum serviço ainda.",
        }}
      />
    </div>
  );
}
