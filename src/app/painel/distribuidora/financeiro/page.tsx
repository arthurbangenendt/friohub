import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { formatarBtu } from "@/lib/btu";
import { Kpi, wrap } from "../../shared";
import { comoPapel } from "../../navegacao";
import { GraficoMeses, type PontoMes } from "@/components/ui/GraficoMeses";
import { DespesasEditor, type Despesa, type PedidoParaDespesa } from "./DespesasEditor";
import { PERIODOS, chaveMes, comoPeriodo, janela, rotuloPeriodo } from "@/lib/periodo";

/* Financeiro da distribuidora: faturado (custo_snapshot de pedidos entregues),
   despesas próprias e o que sobrou — mesma estrutura de painel/financeiro
   (técnico), mas sem gate de plano: distribuidora não tem `subscription_plan_id`
   nem `plano_permite`, o financeiro dela é sempre liberado. */

type ItemPedido = { ambiente: string; quantidade: number; marca: string | null; modelo: string | null; btu: number | null; custo_snapshot: number };
type PedidoRow = { id: string; status: string; custo_snapshot: number; created_at: string; itens: ItemPedido[] };

export default async function FinanceiroDistribuidoraPage({ searchParams }: PageProps<"/painel/distribuidora/financeiro">) {
  const sp = await searchParams;
  const periodo = comoPeriodo(sp.p);
  const { inicio, fim, meses } = janela(periodo);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (comoPapel(profile?.role) !== "distribuidora") redirect("/painel");

  const [{ data: pedidosData }, { data: despesasData }] = await Promise.all([
    supabase
      .from("pedidos_distribuidora")
      .select("id, status, custo_snapshot, created_at, itens")
      .gte("created_at", inicio).lt("created_at", fim)
      .order("created_at", { ascending: false }),
    supabase
      .from("distributor_expenses")
      .select("id, purchase_order_id, categoria, descricao, valor, data")
      .gte("data", inicio.slice(0, 10)).lt("data", fim.slice(0, 10))
      .order("data", { ascending: false }),
  ]);

  const pedidos = ((pedidosData ?? []) as unknown as PedidoRow[]);
  const despesas = ((despesasData ?? []) as Despesa[]).map((d) => ({ ...d, valor: Number(d.valor) }));
  const pedidosParaDespesa: PedidoParaDespesa[] = pedidos.map((p) => ({
    id: p.id,
    label: `${rotuloItens(p.itens)} · ${new Date(p.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} · #${p.id.slice(0, 8)}`,
  }));

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

  return (
    <div style={wrap}>
      <h1 style={{ fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-0.025em", margin: "0 0 6px" }}>Financeiro</h1>
      <p style={{ color: "var(--ink-soft)", margin: "0 0 20px" }}>O que entrou, o que saiu e o que sobrou nos seus pedidos entregues.</p>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 22 }}>
        {PERIODOS.map((p) => {
          const on = p.id === periodo;
          return (
            <Link
              key={p.id}
              href={p.id === "semestre" ? "/painel/distribuidora/financeiro" : `/painel/distribuidora/financeiro?p=${p.id}`}
              aria-current={on ? "page" : undefined}
              style={{
                fontSize: 13, fontWeight: 600, padding: "6px 13px", borderRadius: 100,
                border: "1px solid var(--line)",
                background: on ? "var(--cool)" : "var(--surface)",
                color: on ? "#fff" : "var(--ink-soft)",
              }}
            >
              {p.label}
            </Link>
          );
        })}
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
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 4px" }}>Despesas</h2>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 16px" }}>
          Frete, armazenagem, imposto e os demais custos da operação. Lance aqui pra ver o que sobrou em cada pedido.
        </p>
        <DespesasEditor inicial={despesas} periodo={rotuloPeriodo(periodo)} pedidos={pedidosParaDespesa} />
      </section>

      <section className="card" style={{ padding: 24, marginTop: 16 }}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700 }}>Quanto sobrou em cada pedido</h2>
        <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>
          Valor recebido menos as despesas vinculadas ao pedido. Despesas gerais afetam apenas o resultado do período.
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {entregues.slice(0, 10).map((pedido) => {
            const custo = despesas.filter((d) => d.purchase_order_id === pedido.id).reduce((sum, d) => sum + d.valor, 0);
            const receita = Number(pedido.custo_snapshot);
            return (
              <Link key={pedido.id} href="/painel/distribuidora/pedidos" style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid var(--line-soft)", padding: "8px 0" }}>
                <span>{rotuloItens(pedido.itens)} · #{pedido.id.slice(0, 8)}</span>
                <strong>{formatarBRL(receita - custo)}</strong>
              </Link>
            );
          })}
          {!entregues.length && <span style={{ color: "var(--ink-soft)" }}>A margem aparecerá após o primeiro pedido entregue neste período.</span>}
        </div>
      </section>
    </div>
  );
}

function rotuloItens(itens: ItemPedido[]): string {
  if (!itens?.length) return "Pedido";
  if (itens.length > 1) return `${itens.length} aparelhos`;
  const it = itens[0];
  return `${it.marca ?? "Aparelho"} — ${it.btu ? formatarBtu(it.btu) : it.modelo ?? ""}`;
}
