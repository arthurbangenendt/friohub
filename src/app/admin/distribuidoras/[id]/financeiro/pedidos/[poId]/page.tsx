import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { formatarBtu } from "@/lib/btu";
import { one } from "@/lib/relacional";
import { CATEGORIAS_DESPESA_DIST } from "@/app/painel/distribuidora/financeiro/categorias";
import { STATUS_REPASSE, resolver } from "@/lib/status";

/* Detalhe financeiro de UM pedido/repasse, visto pelo admin — o que a
   distribuidora faturou nele e o que ela mesma lançou de custo. Complementa
   /servico/[id] (operacional: timeline, rastreio) sem duplicá-lo.

   Sem filtro de período de propósito: histórico completo daquele pedido. */

const CATEGORIA_LABEL = Object.fromEntries(CATEGORIAS_DESPESA_DIST.map((c) => [c.id, c.label]));

type ItemJob = { quantidade: number; ambiente: string; produto: { marca: string; modelo: string; btu: number } | null };
type DespesaRow = { id: string; categoria: string; descricao: string | null; valor: number; data: string };

export default async function PedidoFinanceiroDistribuidoraPage({ params, searchParams }: { params: Promise<{ id: string; poId: string }>; searchParams: Promise<{ p?: string }> }) {
  const { id, poId } = await params;
  const sp = await searchParams;
  const periodo = sp.p;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (perfil?.role !== "admin") redirect("/painel");

  const { data: dist } = await supabase
    .from("distributors")
    .select("id, razao_social")
    .eq("id", id)
    .maybeSingle();
  if (!dist) notFound();

  // `.eq("distributor_id", id)` é a única barreira de posse aqui — sem ele,
  // o poId de qualquer distribuidora ficaria visível na ficha de outra.
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, status, custo_snapshot, codigo_rastreio, nota_fiscal_url, prazo_previsto, created_at, orders!inner(job_id)")
    .eq("id", poId)
    .eq("distributor_id", id)
    .maybeSingle();
  if (!po) notFound();
  const jobId = one(po.orders as { job_id: string } | { job_id: string }[] | null)?.job_id ?? null;

  const [{ data: job }, { data: itensData }, { data: despesasData }] = await Promise.all([
    jobId
      ? supabase.from("jobs").select("id, created_at, cidade, endereco").eq("id", jobId).maybeSingle()
      : Promise.resolve({ data: null }),
    jobId
      ? supabase.from("job_itens").select("quantidade, ambiente, produto:products(marca, modelo, btu)").eq("job_id", jobId).eq("distributor_id", id)
      : Promise.resolve({ data: [] as unknown[] }),
    supabase
      .from("distributor_expenses")
      .select("id, categoria, descricao, valor, data")
      .eq("purchase_order_id", poId)
      .eq("distributor_id", id)
      .order("data"),
  ]);

  const itens = ((itensData ?? []) as unknown[]).map((raw) => {
    const row = raw as { quantidade: number; ambiente: string; produto: unknown };
    return { quantidade: row.quantidade, ambiente: row.ambiente, produto: one(row.produto) } as ItemJob;
  });
  const despesas = ((despesasData ?? []) as DespesaRow[]).map((d) => ({ ...d, valor: Number(d.valor) }));

  const receita = Number(po.custo_snapshot);
  const totalDespesas = despesas.reduce((s, d) => s + d.valor, 0);
  const liquido = receita - totalDespesas;
  const st = resolver(STATUS_REPASSE, po.status);

  const voltarHref = `/admin/distribuidoras/${id}/financeiro${periodo ? `?p=${periodo}` : ""}`;
  const titulo = itens.length ? (itens.length > 1 ? `${itens.length} aparelhos` : `${itens[0].produto?.marca ?? "Aparelho"} — ${itens[0].produto ? formatarBtu(itens[0].produto.btu) : ""}`) : "Pedido";

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <p style={{ fontSize: 12, color: "var(--ink-faint)", marginBottom: 6 }}>
        <Link href="/admin/distribuidoras" style={{ color: "inherit" }}>Distribuidoras</Link> {" / "}
        <Link href={voltarHref} style={{ color: "inherit" }}>{dist.razao_social}</Link> {" / "}Pedido
      </p>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: "0 0 6px" }}>{titulo}</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 4 }}>
        {job ? <>{job.cidade}{job.endereco ? ` — ${job.endereco}` : ""} · </> : null}criado em {new Date(po.created_at).toLocaleDateString("pt-BR")}
        {po.prazo_previsto && <> · prazo {new Date(`${po.prazo_previsto}T12:00:00`).toLocaleDateString("pt-BR")}</>}
        {po.codigo_rastreio && <> · rastreio {po.codigo_rastreio}</>}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 100, background: st.bg, color: st.cor }}>{st.label}</span>
        {jobId && <Link href={`/servico/${jobId}`} target="_blank" style={{ fontSize: 12.5, color: "var(--cool-deep)", fontWeight: 600 }}>Ver operação completa →</Link>}
        {po.nota_fiscal_url && <a href={po.nota_fiscal_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: "var(--cool-deep)", fontWeight: 600 }}>Ver nota fiscal →</a>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginBottom: 24 }}>
        <Kpi label="Faturado" valor={formatarBRL(receita)} sufixo="você recebe" />
        <Kpi label="Despesas vinculadas" valor={`- ${formatarBRL(totalDespesas)}`} />
        <Kpi label="Líquido" valor={formatarBRL(liquido)} sufixo="o que sobrou neste pedido" />
      </div>

      {itens.length > 0 && (
        <section className="card" style={{ padding: 24, marginBottom: 16 }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 14 }}>Aparelhos</h2>
          <div style={{ display: "grid", gap: 8 }}>
            {itens.map((it, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid var(--line-soft)", padding: "8px 0" }}>
                <span>{it.ambiente ? `${it.ambiente}: ` : ""}{it.produto?.marca} {it.produto?.modelo}{it.produto?.btu ? ` · ${formatarBtu(it.produto.btu)}` : ""}</span>
                <span style={{ color: "var(--ink-faint)" }}>{it.quantidade}x</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card" style={{ padding: 24 }}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 4 }}>Despesas vinculadas</h2>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 14 }}>O que a distribuidora lançou como custo deste pedido específico.</p>
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
