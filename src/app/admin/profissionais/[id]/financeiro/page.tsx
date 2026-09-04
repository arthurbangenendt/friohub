import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL, TAXA_COMISSAO } from "@/lib/pricing";
import { formatarBtu } from "@/lib/btu";
import { one } from "@/lib/relacional";
import { GraficoMeses, type PontoMes } from "@/components/ui/GraficoMeses";
import { PERIODOS, chaveMes, comoPeriodo, janela, rotuloPeriodo, type PeriodoId } from "@/lib/periodo";

/* Financeiro de UM técnico, visto pelo admin — mesma fórmula de
   painel/financeiro/page.tsx (bruto, comissão, líquido, despesas), mas sem
   depender da RLS para o recorte por dono: jobs_admin_read/orders_admin_read
   são globais (sem filtro por profissional), então TODA query aqui precisa do
   `.eq(..., id)` explícito — esquecer isso mistura o financeiro de todos os
   técnicos numa ficha só. */

const PAGINA_TAM = 20;

type JobRow = { id: string; created_at: string; job_type: string; produto: { marca: string; modelo: string; btu: number } | null };
type OrderRow = { job_id: string; preco_servico: number; comissao_servico: number | null; total: number; payment_status: string; created_at: string };
type DespesaRow = { id: string; job_id: string | null; categoria: string; descricao: string | null; valor: number; data: string };

export default async function FinanceiroProfissionalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ p?: string; pagina?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const periodo = comoPeriodo(sp.p);
  const pagina = Math.max(1, Number(sp.pagina) || 1);
  const { inicio, fim, meses } = janela(periodo);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (perfil?.role !== "admin") redirect("/painel");

  const { data: pro } = await supabase
    .from("professionals")
    .select("id, tipo, cidade, estado, profiles!inner(nome)")
    .eq("id", id)
    .maybeSingle();
  if (!pro) notFound();
  const nome = one(pro.profiles)?.nome ?? "Profissional";

  const [{ data: jobsData }, { data: ordersData }, { data: despesasData }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, created_at, job_type, produto:products(marca, modelo, btu)")
      .eq("profissional_id", id)
      .gte("created_at", inicio).lt("created_at", fim)
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select("job_id, preco_servico, comissao_servico, total, payment_status, created_at, jobs!inner(profissional_id)")
      .eq("jobs.profissional_id", id)
      .gte("created_at", inicio).lt("created_at", fim)
      .order("created_at", { ascending: false }),
    supabase
      .from("expenses")
      .select("id, job_id, categoria, descricao, valor, data")
      .eq("professional_id", id)
      .gte("data", inicio.slice(0, 10)).lt("data", fim.slice(0, 10))
      .order("data", { ascending: false }),
  ]);

  const jobs = ((jobsData ?? []) as unknown[]).map((j) => {
    const row = j as { id: string; created_at: string; job_type: string; produto: unknown };
    return { ...row, produto: one(row.produto) } as JobRow;
  });
  const jobPorId = new Map(jobs.map((j) => [j.id, j]));
  const orders = (ordersData ?? []) as OrderRow[];
  const despesas = ((despesasData ?? []) as DespesaRow[]).map((d) => ({ ...d, valor: Number(d.valor) }));

  const porMes = new Map<string, PontoMes>(meses.map((m) => [m.chave, { mes: m.label, receita: 0, despesa: 0 }]));
  const pagos = orders.filter((o) => o.payment_status === "pago");
  for (const o of pagos) {
    const ponto = porMes.get(chaveMes(o.created_at));
    if (ponto) ponto.receita += o.preco_servico - (o.comissao_servico ?? 0);
  }
  for (const d of despesas) {
    const ponto = porMes.get(chaveMes(d.data));
    if (ponto) ponto.despesa += d.valor;
  }
  const serie = [...porMes.values()];

  const bruto = pagos.reduce((s, o) => s + Number(o.preco_servico), 0);
  const comissao = pagos.reduce((s, o) => s + Number(o.comissao_servico ?? 0), 0);
  const liquido = bruto - comissao;
  const totalDespesas = despesas.reduce((s, d) => s + d.valor, 0);

  const totalPaginas = Math.max(1, Math.ceil(pagos.length / PAGINA_TAM));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const extrato = pagos.slice((paginaAtual - 1) * PAGINA_TAM, paginaAtual * PAGINA_TAM);

  const linkPeriodo = (p: PeriodoId) => `/admin/profissionais/${id}/financeiro?p=${p}`;

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <p style={{ fontSize: 12, color: "var(--ink-faint)", marginBottom: 6 }}>
        <Link href="/admin/profissionais" style={{ color: "inherit" }}>Profissionais</Link> / Financeiro
      </p>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: "0 0 6px" }}>{nome}</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 24 }}>
        {pro.tipo === "empresa" ? "Empresa" : "Autônomo"} · {pro.cidade} — {pro.estado}
      </p>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 22 }}>
        {PERIODOS.map((p) => (
          <Link
            key={p.id}
            href={linkPeriodo(p.id)}
            aria-current={p.id === periodo ? "page" : undefined}
            style={{
              fontSize: 13, fontWeight: 600, padding: "6px 13px", borderRadius: 100,
              border: "1px solid var(--line)",
              background: p.id === periodo ? "var(--cool)" : "var(--surface)",
              color: p.id === periodo ? "#fff" : "var(--ink-soft)",
            }}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12 }}>
        <Kpi label="Recebido bruto" valor={formatarBRL(bruto)} sufixo="pagamentos liquidados" />
        <Kpi label={`Comissão (${Math.round(TAXA_COMISSAO * 100)}%)`} valor={`- ${formatarBRL(comissao)}`} />
        <Kpi label="Despesas" valor={`- ${formatarBRL(totalDespesas)}`} />
        <Kpi label="Resultado" valor={formatarBRL(liquido - totalDespesas)} sufixo="líquido menos despesas" />
      </div>

      <section className="card" style={{ padding: 24, marginTop: 24 }}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 4px" }}>Pagamentos liquidados e despesas</h2>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 6px" }}>{rotuloPeriodo(periodo)}.</p>
        <GraficoMeses dados={serie} comDespesa />
      </section>

      <section style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 4 }}>Extrato por venda</h2>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 14 }}>
          {pagos.length} pagamento(s) liquidado(s) no período · página {paginaAtual} de {totalPaginas}
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {extrato.map((order) => {
            const job = jobPorId.get(order.job_id);
            const custo = despesas.filter((d) => d.job_id === order.job_id).reduce((sum, d) => sum + d.valor, 0);
            const receita = order.preco_servico - (order.comissao_servico ?? 0);
            return (
              <Link key={`${order.job_id}-${order.created_at}`} href={`/servico/${order.job_id}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid var(--line-soft)", padding: "8px 0" }}>
                <span>
                  {job?.produto ? `${job.produto.marca} — ${formatarBtu(job.produto.btu)}` : "Só serviço"}
                  <span style={{ color: "var(--ink-faint)" }}> · {new Date(order.created_at).toLocaleDateString("pt-BR")} · #{order.job_id.slice(0, 8)}</span>
                </span>
                <strong>{formatarBRL(receita - custo)}</strong>
              </Link>
            );
          })}
          {!extrato.length && <span style={{ color: "var(--ink-soft)" }}>Nenhum pagamento liquidado neste período.</span>}
        </div>
        {totalPaginas > 1 && (
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            {paginaAtual > 1 && <Link href={`${linkPeriodo(periodo)}&pagina=${paginaAtual - 1}`} className="btn btn-ghost" style={{ height: 34, padding: "0 12px", fontSize: 13 }}>← Anterior</Link>}
            {paginaAtual < totalPaginas && <Link href={`${linkPeriodo(periodo)}&pagina=${paginaAtual + 1}`} className="btn btn-ghost" style={{ height: 34, padding: "0 12px", fontSize: 13 }}>Próxima →</Link>}
          </div>
        )}
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
