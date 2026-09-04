import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { formatarBtu } from "@/lib/btu";
import { one } from "@/lib/relacional";
import { GraficoMeses, type PontoMes } from "@/components/ui/GraficoMeses";
import { PERIODOS, chaveMes, comoPeriodo, janela, rotuloPeriodo, type PeriodoId } from "@/lib/periodo";

/* Financeiro de UMA distribuidora, visto pelo admin. Faturamento e despesa
   real, não a coluna de custo — `job_itens.custo_snapshot` nunca tem grant
   pra `authenticated` (nem admin lê direto, ver 20260818102000_job_itens_
   custo_privado.sql), então a fonte de custo é sempre `purchase_orders.
   custo_snapshot`. `job_itens` entra só pra identificar o produto do pedido,
   e sempre filtrado também por `distributor_id`: um job pode ter itens de
   mais de uma distribuidora (unique(order_id, distributor_id) em
   purchase_orders desde 20260817122000). */

const PAGINA_TAM = 20;

type ItemJob = { produto_id: string | null; quantidade: number; ambiente: string; produto: { marca: string; modelo: string; btu: number } | null };
type PoRow = { id: string; status: string; custo_snapshot: number; created_at: string; job_id: string };
type DespesaRow = { id: string; purchase_order_id: string | null; categoria: string; descricao: string | null; valor: number; data: string };

export default async function FinanceiroDistribuidoraAdminPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ p?: string; pagina?: string }> }) {
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

  const { data: dist } = await supabase
    .from("distributors")
    .select("id, razao_social, cidade, estado")
    .eq("id", id)
    .maybeSingle();
  if (!dist) notFound();

  const [{ data: poData }, { data: despesasData }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, status, custo_snapshot, created_at, orders!inner(job_id)")
      .eq("distributor_id", id)
      .gte("created_at", inicio).lt("created_at", fim)
      .order("created_at", { ascending: false }),
    supabase
      .from("distributor_expenses")
      .select("id, purchase_order_id, categoria, descricao, valor, data")
      .eq("distributor_id", id)
      .gte("data", inicio.slice(0, 10)).lt("data", fim.slice(0, 10))
      .order("data", { ascending: false }),
  ]);

  const pedidos = ((poData ?? []) as unknown[]).map((p) => {
    const row = p as { id: string; status: string; custo_snapshot: number; created_at: string; orders: unknown };
    const orders = row.orders as { job_id: string } | { job_id: string }[] | null;
    return { id: row.id, status: row.status, custo_snapshot: row.custo_snapshot, created_at: row.created_at, job_id: one(orders)?.job_id ?? "" } as PoRow;
  });
  const jobIds = pedidos.map((p) => p.job_id).filter(Boolean);

  const { data: itensData } = jobIds.length
    ? await supabase
        .from("job_itens")
        .select("job_id, produto_id, quantidade, ambiente, produto:products(marca, modelo, btu)")
        .in("job_id", jobIds)
        .eq("distributor_id", id)
    : { data: [] as unknown[] };

  const itensPorJob = new Map<string, ItemJob[]>();
  for (const raw of (itensData ?? []) as unknown[]) {
    const row = raw as { job_id: string; produto_id: string | null; quantidade: number; ambiente: string; produto: { marca: string; modelo: string; btu: number } | { marca: string; modelo: string; btu: number }[] | null };
    const item: ItemJob = { produto_id: row.produto_id, quantidade: row.quantidade, ambiente: row.ambiente, produto: one(row.produto) };
    const lista = itensPorJob.get(row.job_id) ?? [];
    lista.push(item);
    itensPorJob.set(row.job_id, lista);
  }

  const despesas = ((despesasData ?? []) as DespesaRow[]).map((d) => ({ ...d, valor: Number(d.valor) }));

  const entregues = pedidos.filter((p) => p.status === "entregue");
  const porMes = new Map<string, PontoMes>(meses.map((m) => [m.chave, { mes: m.label, receita: 0, despesa: 0 }]));
  for (const p of entregues) {
    const ponto = porMes.get(chaveMes(p.created_at));
    if (ponto) ponto.receita += Number(p.custo_snapshot);
  }
  for (const d of despesas) {
    const ponto = porMes.get(chaveMes(d.data));
    if (ponto) ponto.despesa += d.valor;
  }
  const serie = [...porMes.values()];

  const faturado = entregues.reduce((s, p) => s + Number(p.custo_snapshot), 0);
  const totalDespesas = despesas.reduce((s, d) => s + d.valor, 0);
  const resultado = faturado - totalDespesas;

  const totalPaginas = Math.max(1, Math.ceil(entregues.length / PAGINA_TAM));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const extrato = entregues.slice((paginaAtual - 1) * PAGINA_TAM, paginaAtual * PAGINA_TAM);

  const linkPeriodo = (p: PeriodoId) => `/admin/distribuidoras/${id}/financeiro?p=${p}`;

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <p style={{ fontSize: 12, color: "var(--ink-faint)", marginBottom: 6 }}>
        <Link href="/admin/distribuidoras" style={{ color: "inherit" }}>Distribuidoras</Link> / Financeiro
      </p>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: "0 0 6px" }}>{dist.razao_social}</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 24 }}>{dist.cidade} — {dist.estado}</p>

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
        <Kpi label="Faturado" valor={formatarBRL(faturado)} sufixo="pedidos entregues" />
        <Kpi label="Despesas" valor={`- ${formatarBRL(totalDespesas)}`} />
        <Kpi label="Resultado" valor={formatarBRL(resultado)} sufixo="faturado menos despesas" />
      </div>

      <section className="card" style={{ padding: 24, marginTop: 24 }}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 4px" }}>Pedidos entregues e despesas</h2>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 6px" }}>{rotuloPeriodo(periodo)}.</p>
        <GraficoMeses dados={serie} comDespesa />
      </section>

      <section style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 4 }}>Extrato por pedido</h2>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 14 }}>
          {entregues.length} pedido(s) entregue(s) no período · página {paginaAtual} de {totalPaginas}
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {extrato.map((pedido) => {
            const custo = despesas.filter((d) => d.purchase_order_id === pedido.id).reduce((sum, d) => sum + d.valor, 0);
            const receita = Number(pedido.custo_snapshot);
            return (
              <div key={pedido.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid var(--line-soft)", padding: "8px 0" }}>
                <span>
                  {rotuloItens(itensPorJob.get(pedido.job_id) ?? [])}
                  <span style={{ color: "var(--ink-faint)" }}> · {new Date(pedido.created_at).toLocaleDateString("pt-BR")} · #{pedido.id.slice(0, 8)}</span>
                </span>
                <strong>{formatarBRL(receita - custo)}</strong>
              </div>
            );
          })}
          {!extrato.length && <span style={{ color: "var(--ink-soft)" }}>Nenhum pedido entregue neste período.</span>}
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

function rotuloItens(itens: ItemJob[]): string {
  if (!itens.length) return "Pedido";
  if (itens.length > 1) return `${itens.length} aparelhos`;
  const it = itens[0];
  return it.produto ? `${it.produto.marca} — ${formatarBtu(it.produto.btu)}` : "Aparelho";
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
