import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { rotuloJob } from "@/app/solicitar/tipos";
import { one } from "@/lib/relacional";
import { EmptyState } from "@/components/ui";
import { ResolverDisputaForm } from "./ResolverDisputaForm";

const TIPO_LABEL: Record<string, string> = {
  contestacao_pos_conclusao: "Contestação pós-conclusão",
  cancelamento_em_execucao: "Cancelamento de serviço pago",
};

const STATUS_LABEL: Record<string, { label: string; bg: string; cor: string }> = {
  aberta: { label: "Aberta", bg: "var(--warm-wash)", cor: "var(--warm)" },
  processando_reembolso: { label: "Processando", bg: "var(--warm-wash)", cor: "var(--warm)" },
  aprovada_reembolso_total: { label: "Reembolso total aprovado", bg: "var(--good-wash)", cor: "var(--good)" },
  aprovada_reembolso_parcial: { label: "Reembolso parcial aprovado", bg: "var(--good-wash)", cor: "var(--good)" },
  rejeitada: { label: "Rejeitada", bg: "var(--surface-2)", cor: "var(--ink-faint)" },
};

type DisputaRow = {
  id: string;
  job_id: string;
  tipo: string;
  motivo: string;
  valor_referencia: number;
  valor_reembolso: number | null;
  situacao_repasse: string | null;
  status: string;
  nota_admin: string | null;
  created_at: string;
  jobType: string;
  clienteNome: string;
  profissionalNome: string;
};

export default async function AdminDisputasPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (perfil?.role !== "admin") redirect("/painel");

  const { data } = await supabase
    .from("job_disputes")
    .select(`id, job_id, tipo, motivo, valor_referencia, valor_reembolso, situacao_repasse, status, nota_admin, created_at,
             job:jobs ( job_type, cliente:profiles!jobs_cliente_id_fkey ( nome ), profissional:professionals ( profiles ( nome ) ) )`)
    .order("created_at", { ascending: false })
    .limit(200);

  type Bruto = {
    id: string; job_id: string; tipo: string; motivo: string;
    valor_referencia: number; valor_reembolso: number | null;
    situacao_repasse: string | null; status: string; nota_admin: string | null; created_at: string;
    job: { job_type: string; cliente: unknown; profissional: unknown } | unknown[] | null;
  };

  const disputas = ((data ?? []) as unknown as Bruto[]).map((d) => {
    const job = one(d.job) as { job_type: string; cliente: unknown; profissional: unknown } | null;
    const profissional = one(job?.profissional) as { profiles: unknown } | null;
    return {
      ...d,
      jobType: job?.job_type ?? "",
      clienteNome: (one(job?.cliente) as { nome: string } | null)?.nome ?? "Cliente",
      profissionalNome: (one(profissional?.profiles) as { nome: string } | null)?.nome ?? "Profissional",
    };
  }) as DisputaRow[];

  const abertas = disputas.filter((d) => ["aberta", "processando_reembolso"].includes(d.status));
  const resolvidas = disputas.filter((d) => !["aberta", "processando_reembolso"].includes(d.status));

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <h1 style={{ fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-0.025em", margin: "0 0 6px" }}>Disputas</h1>
      <p style={{ color: "var(--ink-soft)", margin: "0 0 24px" }}>
        Contestações pós-conclusão e cancelamentos de serviço já pago. Aprovar dispara o estorno de verdade no Asaas na hora.
      </p>

      <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 12px" }}>Abertas ({abertas.length})</h2>
      {abertas.length === 0 ? (
        <EmptyState titulo="Nenhuma disputa aberta" descricao="Contestações e cancelamentos de job pago aparecem aqui." />
      ) : (
        <div style={{ display: "grid", gap: 12, marginBottom: 32 }}>
          {abertas.map((d) => <CardDisputa key={d.id} d={d} />)}
        </div>
      )}

      {resolvidas.length > 0 && (
        <>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 12px" }}>Histórico</h2>
          <div style={{ display: "grid", gap: 8 }}>
            {resolvidas.map((d) => <CardDisputa key={d.id} d={d} resolvida />)}
          </div>
        </>
      )}
    </main>
  );
}

function CardDisputa({ d, resolvida }: { d: DisputaRow; resolvida?: boolean }) {
  const st = STATUS_LABEL[d.status] ?? STATUS_LABEL.aberta;

  return (
    <div className="card" style={{ padding: resolvida ? 16 : 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 14.5 }}>{TIPO_LABEL[d.tipo] ?? d.tipo}</strong>
            <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 100, background: st.bg, color: st.cor }}>{st.label}</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 3 }}>
            {d.jobType ? rotuloJob(d.jobType) : "Serviço"} · Cliente: {d.clienteNome} · Profissional: {d.profissionalNome}
          </div>
        </div>
        <Link href={`/servico/${d.job_id}`} style={{ fontSize: 13, color: "var(--cool)", whiteSpace: "nowrap" }}>Ver serviço →</Link>
      </div>

      <p style={{ fontSize: 13.5, color: "var(--ink)", margin: "10px 0 0" }}>{d.motivo}</p>

      <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12.5, color: "var(--ink-faint)", flexWrap: "wrap" }}>
        <span>Valor de referência: <strong style={{ color: "var(--ink)" }}>{formatarBRL(d.valor_referencia)}</strong></span>
        {d.valor_reembolso !== null && <span>Reembolsado: <strong style={{ color: "var(--ink)" }}>{formatarBRL(d.valor_reembolso)}</strong></span>}
        <span>{new Date(d.created_at).toLocaleString("pt-BR")}</span>
      </div>

      {d.situacao_repasse === "ja_enviado" && !resolvida && (
        <div style={{ marginTop: 10, padding: "10px 13px", borderRadius: 10, background: "var(--danger-wash)", fontSize: 13, color: "var(--danger)" }}>
          O repasse deste serviço já foi enviado ao profissional — se o reembolso for aprovado, reaver esse valor é um contato manual, fora do sistema.
        </div>
      )}

      {d.nota_admin && resolvida && (
        <p style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 8 }}>Nota: {d.nota_admin}</p>
      )}

      {!resolvida && d.status === "aberta" && (
        <ResolverDisputaForm disputeId={d.id} valorReferencia={d.valor_referencia} />
      )}
      {d.status === "processando_reembolso" && (
        <p style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 10 }}>Reembolso em processamento — recarregue em instantes.</p>
      )}
    </div>
  );
}
