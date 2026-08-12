import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL, TAXA_COMISSAO } from "@/lib/pricing";
import { formatarBtu } from "@/lib/btu";
import { JobActions } from "./JobActions";
import { ReviewForm } from "./ReviewForm";
import { Star } from "@/components/icons";

const mono = "var(--font-geist-mono), ui-monospace, monospace";
const JOB_LABEL: Record<string, string> = {
  instalacao_com_equipamento: "Instalação de ar novo",
  manutencao: "Manutenção", remanejamento: "Remanejamento", limpeza: "Limpeza", conserto: "Conserto",
};
const STATUS: Record<string, { label: string; cor: string; bg: string }> = {
  aberto: { label: "Aberto", cor: "var(--ink-faint)", bg: "var(--surface-2)" },
  aguardando_profissional: { label: "Aguardando profissional", cor: "var(--warm)", bg: "var(--warm-wash)" },
  aceito: { label: "Aceito", cor: "var(--cool-deep)", bg: "var(--cool-wash)" },
  em_execucao: { label: "Em execução", cor: "var(--cool-deep)", bg: "var(--cool-wash)" },
  concluido: { label: "Concluído", cor: "var(--good)", bg: "var(--cool-wash)" },
  avaliado: { label: "Avaliado", cor: "var(--good)", bg: "var(--cool-wash)" },
  cancelado: { label: "Cancelado", cor: "#b3261e", bg: "#fdeceb" },
};

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

export default async function ServicoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: job } = await supabase
    .from("jobs")
    .select(`id, job_type, status, created_at, ambiente, area_m2, btu_recomendado, cep, endereco, descricao, cliente_id, profissional_id,
             produto:products ( marca, modelo, btu, preco_venda ),
             profissional:professionals ( id, tipo, profiles ( nome ) ),
             cliente:profiles!jobs_cliente_id_fkey ( nome ),
             order:orders ( preco_produto, preco_servico, comissao_servico, margem_produto, total, payment_status ),
             review:reviews ( rating, comment )`)
    .eq("id", id)
    .single();

  if (!job) redirect("/painel");

  const isCliente = job.cliente_id === user.id;
  const isPro = job.profissional_id === user.id;
  if (!isCliente && !isPro) redirect("/painel");

  const produto = one(job.produto) as { marca: string; modelo: string; btu: number; preco_venda: number } | null;
  const proNome = one(one(job.profissional)?.profiles)?.nome ?? "Profissional";
  const cliNome = one(job.cliente)?.nome ?? "Cliente";
  const order = one(job.order) as { preco_produto: number; preco_servico: number; comissao_servico: number; margem_produto: number; total: number; payment_status: string } | null;
  const review = one(job.review) as { rating: number; comment: string | null } | null;
  const st = STATUS[job.status] ?? STATUS.aberto;

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <Link href="/painel" style={{ fontFamily: mono, fontSize: 13, color: "var(--ink-faint)" }}>← Painel</Link>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, margin: "20px 0 6px" }}>
        <h1 style={{ fontSize: "1.7rem", fontWeight: 800 }}>{JOB_LABEL[job.job_type] ?? job.job_type}</h1>
        <span style={{ fontSize: 13, fontFamily: mono, padding: "6px 12px", borderRadius: 100, background: st.bg, color: st.cor, whiteSpace: "nowrap" }}>{st.label}</span>
      </div>
      <p style={{ color: "var(--ink-faint)", fontSize: 14, marginBottom: 28 }}>
        {isPro ? `Cliente: ${cliNome}` : `Profissional: ${proNome}`}
      </p>

      <div style={{ display: "grid", gap: 16 }}>
        {/* detalhes */}
        <div className="card" style={{ padding: 22 }}>
          <SecTitle>Detalhes</SecTitle>
          {job.ambiente && <Linha k="Ambiente" v={job.ambiente} />}
          {job.area_m2 && <Linha k="Área" v={`${job.area_m2} m²`} />}
          {job.btu_recomendado ? <Linha k="Capacidade" v={formatarBtu(job.btu_recomendado)} /> : null}
          {produto && <Linha k="Aparelho" v={`${produto.marca} — ${produto.modelo}`} />}
          <Linha k="Endereço" v={`${job.endereco ?? "-"} · ${job.cep}`} />
          {job.descricao && <Linha k="Descrição" v={job.descricao} />}
        </div>

        {/* valores */}
        {order && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>{isPro ? "Seu recebimento" : "Valores"}</SecTitle>
            {isPro ? (
              <>
                <Linha k="Mão de obra (instalação)" v={formatarBRL(order.preco_servico)} />
                <Linha k={`Taxa FrioHub (${Math.round(TAXA_COMISSAO * 100)}%)`} v={`- ${formatarBRL(order.comissao_servico)}`} />
                <Linha k={<strong>Você recebe</strong>} v={<strong>{formatarBRL(order.preco_servico - order.comissao_servico)}</strong>} />
              </>
            ) : (
              <>
                {order.preco_produto > 0 && <Linha k="Aparelho" v={formatarBRL(order.preco_produto)} />}
                <Linha k="Instalação" v={formatarBRL(order.preco_servico)} />
                <Linha k={<strong>Total</strong>} v={<strong>{formatarBRL(order.total)}</strong>} />
                <Linha k="Pagamento" v={order.payment_status === "pago" ? "Pago" : "Pendente"} />
              </>
            )}
          </div>
        )}

        {/* ações do profissional */}
        {isPro && ["aguardando_profissional", "aceito", "em_execucao"].includes(job.status) && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>Ação</SecTitle>
            <JobActions jobId={job.id} status={job.status} />
          </div>
        )}

        {/* avaliação do cliente */}
        {isCliente && job.status === "concluido" && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>Avalie o serviço</SecTitle>
            <p style={{ color: "var(--ink-soft)", fontSize: 14, marginBottom: 16 }}>Sua nota ajuda outros clientes e valoriza os bons profissionais.</p>
            <ReviewForm jobId={job.id} />
          </div>
        )}

        {/* avaliação já feita */}
        {review && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>Avaliação</SecTitle>
            <div style={{ display: "flex", gap: 4, marginBottom: review.comment ? 10 : 0 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n} style={{ color: review.rating >= n ? "var(--warm)" : "var(--ink-faint)", display: "flex" }}>
                  <Star size={20} filled={review.rating >= n} />
                </span>
              ))}
            </div>
            {review.comment && <p style={{ color: "var(--ink-soft)", fontSize: 15 }}>{review.comment}</p>}
          </div>
        )}
      </div>
    </main>
  );
}

function SecTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12.5, fontWeight: 650, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)", marginBottom: 14 }}>{children}</div>;
}
function Linha({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "8px 0", fontSize: 14.5, borderBottom: "1px solid var(--line-soft)" }}>
      <span style={{ color: "var(--ink-faint)" }}>{k}</span>
      <span style={{ textAlign: "right" }}>{v}</span>
    </div>
  );
}
