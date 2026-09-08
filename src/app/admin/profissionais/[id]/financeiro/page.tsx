import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL, TAXA_COMISSAO } from "@/lib/pricing";
import { formatarBtu } from "@/lib/btu";
import { one } from "@/lib/relacional";
import { GraficoMeses, type PontoMes } from "@/components/ui/GraficoMeses";
import { WeeklyExpenseCard } from "@/components/ui/card-20";
import { resumirCategorias } from "@/lib/resumo-despesas";
import { CATEGORIAS_DESPESA } from "@/app/painel/financeiro/categorias";
import { PERIODOS, chaveMes, comoPeriodo, janela, rotuloPeriodo, type PeriodoId } from "@/lib/periodo";
import { STATUS_PAGAMENTO, resolver } from "@/lib/status";

/* Financeiro de UM técnico, visto pelo admin — mesma fórmula de
   painel/financeiro/page.tsx (bruto, comissão, líquido, despesas), mas sem
   depender da RLS para o recorte por dono: jobs_admin_read/orders_admin_read
   são globais (sem filtro por profissional), então TODA query aqui precisa do
   `.eq(..., id)` explícito — esquecer isso mistura o financeiro de todos os
   técnicos numa ficha só. */

const PAGINA_TAM = 20;
const CATEGORIA_LABEL = Object.fromEntries(CATEGORIAS_DESPESA.map((c) => [c.id, c.label]));

type JobRow = { id: string; created_at: string; job_type: string; produto: { marca: string; modelo: string; btu: number } | null };
type OrderRow = { job_id: string; preco_servico: number; comissao_servico: number | null; total: number; payment_status: string; created_at: string };
type DespesaRow = { id: string; job_id: string | null; categoria: string; descricao: string | null; valor: number; data: string };
type CompraRow = { job_id: string; total: number; payment_status: string; created_at: string };

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

  const [{ data: jobsData }, { data: ordersData }, { data: despesasData }, { data: comprasData }] = await Promise.all([
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
    // Compra avulsa: o técnico comprando aparelho/peça direto da distribuidora,
    // sem orçamento de cliente. Vira `jobs.cliente_id = ele mesmo` (profissional_id
    // fica nulo) — nunca aparece na query de orders acima, que filtra por
    // `jobs.profissional_id`. É dinheiro SAINDO do bolso dele, não faturamento;
    // por isso mora numa seção própria, fora do KPI "Resultado".
    supabase
      .from("orders")
      .select("job_id, total, payment_status, created_at, jobs!inner(cliente_id, job_type)")
      .eq("jobs.cliente_id", id)
      .eq("jobs.job_type", "compra_equipamento")
      .gte("created_at", inicio).lt("created_at", fim)
      .order("created_at", { ascending: false }),
  ]);

  const jobs = ((jobsData ?? []) as unknown[]).map((j) => {
    const row = j as { id: string; created_at: string; job_type: string; produto: unknown };
    return { ...row, produto: one(row.produto) } as JobRow;
  });
  const jobPorId = new Map(jobs.map((j) => [j.id, j]));
  const orders = (ordersData ?? []) as OrderRow[];
  const despesas = ((despesasData ?? []) as DespesaRow[]).map((d) => ({ ...d, valor: Number(d.valor) }));
  const compras = ((comprasData ?? []) as unknown[]).map((c) => {
    const row = c as { job_id: string; total: number; payment_status: string; created_at: string };
    return { job_id: row.job_id, total: Number(row.total), payment_status: row.payment_status, created_at: row.created_at } as CompraRow;
  });

  const comprasJobIds = compras.map((c) => c.job_id);
  const { data: comprasProdutoData } = comprasJobIds.length
    ? await supabase.from("jobs").select("id, produto:products(marca, modelo, btu)").in("id", comprasJobIds)
    : { data: [] as unknown[] };
  const produtoPorCompra = new Map((comprasProdutoData ?? []).map((raw) => {
    const row = raw as { id: string; produto: unknown };
    return [row.id, one(row.produto) as { marca: string; modelo: string; btu: number } | null];
  }));

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
  const totalCompras = compras.filter((c) => c.payment_status === "pago").reduce((s, c) => s + c.total, 0);

  const resumoDespesas = resumirCategorias(
    despesas.map((d) => ({ ...d, vinculoId: d.job_id })),
    CATEGORIA_LABEL,
  );

  // Extrato agora cobre TODOS os pedidos do período, não só os liquidados —
  // com etiqueta de status pra deixar claro o que ainda não caiu.
  const totalPaginas = Math.max(1, Math.ceil(orders.length / PAGINA_TAM));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const extrato = orders.slice((paginaAtual - 1) * PAGINA_TAM, paginaAtual * PAGINA_TAM);

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
        <Kpi label="Compras avulsas" valor={formatarBRL(totalCompras)} sufixo="informativo — fora do resultado" />
      </div>

      <section className="card" style={{ padding: 24, marginTop: 24 }}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 4px" }}>Pagamentos liquidados e despesas</h2>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 6px" }}>{rotuloPeriodo(periodo)}.</p>
        <GraficoMeses dados={serie} comDespesa />
      </section>

      <section style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 4 }}>Despesas</h2>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 14 }}>
          {despesas.length} lançamento(s) no período.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 320px) 1fr", gap: 16, alignItems: "start" }}>
          <WeeklyExpenseCard title="Por categoria" dateRange={rotuloPeriodo(periodo)} data={resumoDespesas} />
          <div style={{ display: "grid", gap: 6, maxHeight: 380, overflowY: "auto", paddingRight: 4 }}>
            {despesas.map((d) => (
              <div key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 12px", borderRadius: 10, background: "var(--surface)", border: "1px solid var(--line)" }}>
                <span>
                  <strong style={{ fontSize: 13.5 }}>{CATEGORIA_LABEL[d.categoria] ?? d.categoria}</strong>
                  {d.descricao && <span style={{ color: "var(--ink-soft)" }}> — {d.descricao}</span>}
                  <span style={{ display: "block", fontSize: 12, color: "var(--ink-faint)" }}>
                    {new Date(`${d.data}T12:00:00`).toLocaleDateString("pt-BR")}
                    {d.job_id && <> · vinculada a <Link href={`/admin/profissionais/${id}/financeiro/pedidos/${d.job_id}?p=${periodo}`} style={{ color: "var(--cool-deep)" }}>#{d.job_id.slice(0, 8)}</Link></>}
                  </span>
                </span>
                <strong style={{ whiteSpace: "nowrap" }}>{formatarBRL(d.valor)}</strong>
              </div>
            ))}
            {!despesas.length && <span style={{ color: "var(--ink-soft)" }}>Nenhuma despesa lançada neste período.</span>}
          </div>
        </div>
      </section>

      <section style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 4 }}>Compras avulsas</h2>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 14 }}>
          Aparelhos/peças que o próprio técnico comprou da distribuidora, sem orçamento de cliente. É gasto dele, não entra no resultado do serviço.
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {compras.map((c) => {
            const produto = produtoPorCompra.get(c.job_id);
            const st = resolver(STATUS_PAGAMENTO, c.payment_status);
            return (
              <div key={c.job_id} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid var(--line-soft)", padding: "8px 0" }}>
                <span>
                  {produto ? `${produto.marca} — ${formatarBtu(produto.btu)}` : "Aparelho"}
                  <span style={{ color: "var(--ink-faint)" }}> · {new Date(c.created_at).toLocaleDateString("pt-BR")} · #{c.job_id.slice(0, 8)}</span>
                  <span style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 100, background: st.bg, color: st.cor }}>{st.label}</span>
                </span>
                <strong>{formatarBRL(c.total)}</strong>
              </div>
            );
          })}
          {!compras.length && <span style={{ color: "var(--ink-soft)" }}>Nenhuma compra avulsa neste período.</span>}
        </div>
      </section>

      <section style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 4 }}>Todos os pedidos</h2>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 14 }}>
          {orders.length} pedido(s) no período · página {paginaAtual} de {totalPaginas}
        </p>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 640 }}>
            <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 100px 100px 100px 100px 100px", gap: 10, padding: "0 12px 8px", fontSize: 11, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              <span>Data</span><span>Produto/serviço</span><span>Status</span><span>Bruto</span><span>Comissão</span><span>Despesas</span><span>Líquido</span>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {extrato.map((order) => {
                const job = jobPorId.get(order.job_id);
                const custo = despesas.filter((d) => d.job_id === order.job_id).reduce((sum, d) => sum + d.valor, 0);
                const liquidoLinha = order.preco_servico - (order.comissao_servico ?? 0) - custo;
                const st = resolver(STATUS_PAGAMENTO, order.payment_status);
                return (
                  <Link
                    key={`${order.job_id}-${order.created_at}`}
                    href={`/admin/profissionais/${id}/financeiro/pedidos/${order.job_id}?p=${periodo}`}
                    className="card"
                    style={{ display: "grid", gridTemplateColumns: "90px 1fr 100px 100px 100px 100px 100px", gap: 10, padding: "10px 12px", alignItems: "center", fontSize: 13 }}
                  >
                    <span style={{ color: "var(--ink-faint)" }}>{new Date(order.created_at).toLocaleDateString("pt-BR")}</span>
                    <span>{job?.produto ? `${job.produto.marca} — ${formatarBtu(job.produto.btu)}` : "Só serviço"} <span style={{ color: "var(--ink-faint)" }}>#{order.job_id.slice(0, 8)}</span></span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 100, background: st.bg, color: st.cor, justifySelf: "start" }}>{st.label}</span>
                    <span>{formatarBRL(order.preco_servico)}</span>
                    <span>{formatarBRL(order.comissao_servico ?? 0)}</span>
                    <span>{formatarBRL(custo)}</span>
                    <strong>{formatarBRL(liquidoLinha)}</strong>
                  </Link>
                );
              })}
              {!extrato.length && <span style={{ color: "var(--ink-soft)" }}>Nenhum pedido neste período.</span>}
            </div>
          </div>
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
