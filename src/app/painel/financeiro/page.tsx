import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL, TAXA_COMISSAO } from "@/lib/pricing";
import { Kpi, FECHADOS, wrap } from "../shared";
import { GraficoMeses, type PontoMes } from "./GraficoMeses";
import { DespesasEditor, type Despesa } from "./DespesasEditor";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Últimos 6 meses, do mais antigo ao mais recente, como chaves "AAAA-MM". */
function ultimosSeisMeses(): { chave: string; label: string }[] {
  const hoje = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - (5 - i), 1);
    return {
      chave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: MESES[d.getMonth()],
    };
  });
}

const chaveMes = (iso: string) => iso.slice(0, 7);

export default async function FinanceiroPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const isPro = profile?.role === "profissional";

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, status, created_at, job_type")
    .order("created_at", { ascending: false })
    .limit(300);

  const { data: ordersData } = isPro
    ? await supabase.from("orders").select("job_id, preco_servico, comissao_servico, total, payment_status, created_at")
    : await supabase.from("orders_cliente").select("job_id, preco_servico, total, payment_status, created_at");

  type OrderRow = { job_id: string; preco_servico: number; comissao_servico?: number; total: number; payment_status: string; created_at: string };
  const orders = (ordersData ?? []) as OrderRow[];
  const orderPorJob = new Map(orders.map((o) => [o.job_id, o]));

  // Despesas só existem para o profissional — é custo operacional dele.
  const { data: despesasData } = isPro
    ? await supabase.from("expenses").select("id, categoria, descricao, valor, data").order("data", { ascending: false }).limit(100)
    : { data: [] };
  const despesas = ((despesasData ?? []) as Despesa[]).map((d) => ({ ...d, valor: Number(d.valor) }));

  const meses = ultimosSeisMeses();
  const porMes = new Map<string, PontoMes>(meses.map((m) => [m.chave, { mes: m.label, receita: 0, despesa: 0 }]));

  const concluidos = (jobs ?? []).filter((j) => FECHADOS.includes(j.status));
  const pagos = orders.filter((o) => o.payment_status === "pago");
  for (const o of pagos) {
    const ponto = porMes.get(chaveMes(o.created_at));
    if (!ponto) continue;
    ponto.receita += isPro ? o.preco_servico - (o.comissao_servico ?? 0) : o.total;
  }
  for (const d of despesas) {
    const ponto = porMes.get(chaveMes(d.data));
    if (ponto) ponto.despesa += d.valor;
  }
  const serie = [...porMes.values()];

  // Receita só existe quando o gateway liquidou o pagamento. Status do serviço
  // não é evidência financeira e não entra mais nesses KPIs.
  const bruto = pagos.reduce((s, o) => s + o.preco_servico, 0);
  const comissao = pagos.reduce((s, o) => s + (o.comissao_servico ?? 0), 0);
  const liquido = bruto - comissao;
  const totalDespesas = despesas.reduce((s, d) => s + d.valor, 0);
  const totalCliente = orders.reduce((s, o) => s + o.total, 0);
  const totalPagoCliente = pagos.reduce((s, o) => s + o.total, 0);
  const aReceber = concluidos.reduce((s, j) => {
    const o = orderPorJob.get(j.id);
    if (!o || o.payment_status === "pago") return s;
    return s + (o.preco_servico - (o.comissao_servico ?? 0));
  }, 0);

  return (
    <div style={wrap}>
      <h1 style={{ fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-0.025em", margin: "0 0 6px" }}>Financeiro</h1>
      <p style={{ color: "var(--ink-soft)", margin: "0 0 28px" }}>
        {isPro
          ? "O que entrou, o que saiu e o que ainda está para receber."
          : "Quanto você já contratou pela plataforma."}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12 }}>
        {isPro ? (
          <>
            <Kpi label="Recebido bruto" valor={formatarBRL(bruto)} sufixo="pagamentos liquidados" />
            <Kpi label={`Comissão (${Math.round(TAXA_COMISSAO * 100)}%)`} valor={`- ${formatarBRL(comissao)}`} />
            <Kpi label="Despesas" valor={`- ${formatarBRL(totalDespesas)}`} />
            <Kpi label="Resultado" valor={formatarBRL(liquido - totalDespesas)} sufixo="líquido menos despesas" />
          </>
        ) : (
          <>
            <Kpi label="Total contratado" valor={formatarBRL(totalCliente)} />
            <Kpi label="Total pago" valor={formatarBRL(totalPagoCliente)} />
            <Kpi label="Serviços concluídos" valor={String(concluidos.length)} />
          </>
        )}
      </div>

      {isPro && aReceber > 0 && (
        <div style={{ marginTop: 16, padding: "14px 18px", borderRadius: 12, background: "var(--warm-wash)", color: "var(--warm)", fontSize: 13.5, lineHeight: 1.6 }}>
          <strong style={{ color: "var(--ink)" }}>{formatarBRL(aReceber)} a receber.</strong>{" "}
          São serviços concluídos cuja liquidação ainda não foi registrada. Status do serviço não
          é usado como comprovante de pagamento.
        </div>
      )}

      <section className="card" style={{ padding: 24, marginTop: 24 }}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 4px" }}>
          {isPro ? "Pagamentos liquidados e despesas" : "Pagamentos liquidados por mês de contratação"}
        </h2>
        <p style={{ fontSize: 13, color: "var(--ink-faint)", margin: "0 0 6px" }}>Últimos 6 meses.</p>
        <GraficoMeses dados={serie} comDespesa={isPro} />
      </section>

      {isPro && (
        <section className="card" style={{ padding: 24, marginTop: 16 }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 4px" }}>Despesas</h2>
          <p style={{ fontSize: 13, color: "var(--ink-faint)", margin: "0 0 16px" }}>
            Deslocamento, gás, peça, ajudante. É o que separa faturamento de lucro.
          </p>
          <DespesasEditor inicial={despesas} />
        </section>
      )}
    </div>
  );
}
