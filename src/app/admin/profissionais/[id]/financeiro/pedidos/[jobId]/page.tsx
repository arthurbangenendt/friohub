import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL, TAXA_COMISSAO } from "@/lib/pricing";
import { formatarBtu } from "@/lib/btu";
import { one } from "@/lib/relacional";
import { rotuloJob } from "@/app/solicitar/tipos";
import { CATEGORIAS_DESPESA } from "@/app/painel/financeiro/categorias";
import { STATUS_JOB, STATUS_PAGAMENTO, resolver } from "@/lib/status";

const CATEGORIA_LABEL = Object.fromEntries(CATEGORIAS_DESPESA.map((c) => [c.id, c.label]));

/* Detalhe financeiro de UMA obra/pedido, visto pelo admin — "o que entrou,
   o que a plataforma tirou de comissão e o que o técnico gastou nele", tudo
   junto. Complementa /servico/[id] (que é operacional: timeline, execução,
   fotos) sem duplicá-lo — aqui o foco é só dinheiro.

   Sem filtro de período de propósito: é o histórico completo daquele job,
   não um recorte do mês que o admin estava olhando na ficha. */

const ORIGEM_LABEL: Record<string, string> = {
  aceite_quote: "Aceite do orçamento",
  orcamento_final: "Serviço (pós-visita)",
  compra_avulsa: "Compra de aparelho",
};

type OrderRow = {
  id: string; preco_servico: number; preco_produto: number; comissao_servico: number | null;
  total: number; payment_status: string; origem: string; created_at: string;
};
type DespesaRow = { id: string; categoria: string; descricao: string | null; valor: number; data: string };

export default async function PedidoFinanceiroProfissionalPage({ params, searchParams }: { params: Promise<{ id: string; jobId: string }>; searchParams: Promise<{ p?: string }> }) {
  const { id, jobId } = await params;
  const sp = await searchParams;
  const periodo = sp.p;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (perfil?.role !== "admin") redirect("/painel");

  const { data: pro } = await supabase
    .from("professionals")
    .select("id, profiles!inner(nome)")
    .eq("id", id)
    .maybeSingle();
  if (!pro) notFound();
  const nome = one(pro.profiles)?.nome ?? "Profissional";

  // `.eq("profissional_id", id)` aqui é a única barreira de posse: sem ele,
  // qualquer jobId de qualquer técnico ficaria visível na ficha de outro.
  const { data: job } = await supabase
    .from("jobs")
    .select("id, created_at, status, job_type, cidade, endereco, produto:products(marca, modelo, btu)")
    .eq("id", jobId)
    .eq("profissional_id", id)
    .maybeSingle();
  if (!job) notFound();
  const produto = one(job.produto) as { marca: string; modelo: string; btu: number } | null;

  const [{ data: ordersData }, { data: despesasData }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, preco_servico, preco_produto, comissao_servico, total, payment_status, origem, created_at")
      .eq("job_id", jobId)
      .order("created_at"),
    supabase
      .from("expenses")
      .select("id, categoria, descricao, valor, data")
      .eq("job_id", jobId)
      .eq("professional_id", id)
      .order("data"),
  ]);

  const orders = (ordersData ?? []) as OrderRow[];
  const despesas = ((despesasData ?? []) as DespesaRow[]).map((d) => ({ ...d, valor: Number(d.valor) }));

  const pagos = orders.filter((o) => o.payment_status === "pago");
  const bruto = pagos.reduce((s, o) => s + Number(o.preco_servico), 0);
  const comissao = pagos.reduce((s, o) => s + Number(o.comissao_servico ?? 0), 0);
  const totalDespesas = despesas.reduce((s, d) => s + d.valor, 0);
  const liquido = bruto - comissao - totalDespesas;

  const voltarHref = `/admin/profissionais/${id}/financeiro${periodo ? `?p=${periodo}` : ""}`;

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <p style={{ fontSize: 12, color: "var(--ink-faint)", marginBottom: 6 }}>
        <Link href="/admin/profissionais" style={{ color: "inherit" }}>Profissionais</Link> {" / "}
        <Link href={voltarHref} style={{ color: "inherit" }}>{nome}</Link> {" / "}Pedido
      </p>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: "0 0 6px" }}>
        {produto ? `${produto.marca} — ${formatarBtu(produto.btu)}` : rotuloJob(job.job_type)}
      </h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 4 }}>
        {rotuloJob(job.job_type)} · {job.cidade}{job.endereco ? ` — ${job.endereco}` : ""} · criado em {new Date(job.created_at).toLocaleDateString("pt-BR")}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
        {(() => { const st = resolver(STATUS_JOB, job.status); return <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 100, background: st.bg, color: st.cor }}>{st.label}</span>; })()}
        <Link href={`/servico/${job.id}`} target="_blank" style={{ fontSize: 12.5, color: "var(--cool-deep)", fontWeight: 600 }}>Ver operação completa →</Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginBottom: 24 }}>
        <Kpi label="Recebido bruto" valor={formatarBRL(bruto)} sufixo="pagamentos liquidados" />
        <Kpi label={`Comissão (${Math.round(TAXA_COMISSAO * 100)}%)`} valor={`- ${formatarBRL(comissao)}`} />
        <Kpi label="Despesas vinculadas" valor={`- ${formatarBRL(totalDespesas)}`} />
        <Kpi label="Líquido" valor={formatarBRL(liquido)} sufixo="o que sobrou nesta obra" />
      </div>

      <section className="card" style={{ padding: 24 }}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 14 }}>Pagamentos</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {orders.map((o) => {
            const st = resolver(STATUS_PAGAMENTO, o.payment_status);
            return (
              <div key={o.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid var(--line-soft)", padding: "8px 0" }}>
                <span>
                  {ORIGEM_LABEL[o.origem] ?? o.origem}
                  <span style={{ color: "var(--ink-faint)" }}> · {new Date(o.created_at).toLocaleDateString("pt-BR")}</span>
                  <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 100, background: st.bg, color: st.cor }}>{st.label}</span>
                  {o.preco_produto > 0 && <span style={{ display: "block", fontSize: 12, color: "var(--ink-faint)" }}>Aparelho: {formatarBRL(o.preco_produto)}</span>}
                </span>
                <span style={{ textAlign: "right" }}>
                  <strong style={{ display: "block" }}>{formatarBRL(o.preco_servico)}</strong>
                  {(o.comissao_servico ?? 0) > 0 && <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>- {formatarBRL(o.comissao_servico ?? 0)} comissão</span>}
                </span>
              </div>
            );
          })}
          {!orders.length && <span style={{ color: "var(--ink-soft)" }}>Nenhum pagamento registrado para este pedido.</span>}
        </div>
      </section>

      <section className="card" style={{ padding: 24, marginTop: 16 }}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 4 }}>Despesas vinculadas</h2>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 14 }}>O que o técnico lançou como custo desta obra específica.</p>
        <div style={{ display: "grid", gap: 8 }}>
          {despesas.map((d) => (
            <div key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid var(--line-soft)", padding: "8px 0" }}>
              <span>
                <strong>{CATEGORIA_LABEL[d.categoria] ?? d.categoria}</strong>
                {d.descricao && <span style={{ color: "var(--ink-soft)" }}> — {d.descricao}</span>}
                <span style={{ display: "block", fontSize: 12, color: "var(--ink-faint)" }}>{new Date(`${d.data}T12:00:00`).toLocaleDateString("pt-BR")}</span>
              </span>
              <strong>{formatarBRL(d.valor)}</strong>
            </div>
          ))}
          {!despesas.length && <span style={{ color: "var(--ink-soft)" }}>Nenhuma despesa vinculada a este pedido.</span>}
        </div>
      </section>
    </main>
  );
}

function Kpi({ label, valor, sufixo }: { label: string; valor: string; sufixo?: string }) {
  return (
    <div style={{ padding: "16px 18px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--line)" }}>
      <div style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-faint)" }}>{label}</div>
      <div style={{ fontSize: "1.45rem", fontWeight: 800, letterSpacing: "-0.02em", marginTop: 6 }}>{valor}</div>
      {sufixo && <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 2 }}>{sufixo}</div>}
    </div>
  );
}
