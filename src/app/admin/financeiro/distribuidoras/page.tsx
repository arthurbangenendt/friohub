import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { EmptyState } from "@/components/ui";
import { PERIODOS, comoPeriodo, janela, rotuloPeriodo } from "@/lib/periodo";

/* Ranking de ganhos por distribuidora — mesma ideia de admin/financeiro/
   tecnicos/page.tsx, sobre purchase_orders/distributor_expenses. */

export default async function RankingDistribuidorasPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const sp = await searchParams;
  const periodo = comoPeriodo(sp.p);
  const { inicio, fim } = janela(periodo);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (perfil?.role !== "admin") redirect("/painel");

  const [{ data: dists }, { data: poData }, { data: expensesData }] = await Promise.all([
    supabase.from("distributors").select("id, razao_social"),
    supabase
      .from("purchase_orders")
      .select("distributor_id, custo_snapshot")
      .eq("status", "entregue")
      .gte("created_at", inicio).lt("created_at", fim),
    supabase
      .from("distributor_expenses")
      .select("distributor_id, valor")
      .gte("data", inicio.slice(0, 10)).lt("data", fim.slice(0, 10)),
  ]);

  const nomePorId = new Map((dists ?? []).map((d) => [d.id, d.razao_social]));

  const faturado = new Map<string, number>();
  const pedidos = new Map<string, number>();
  for (const row of poData ?? []) {
    faturado.set(row.distributor_id, (faturado.get(row.distributor_id) ?? 0) + Number(row.custo_snapshot));
    pedidos.set(row.distributor_id, (pedidos.get(row.distributor_id) ?? 0) + 1);
  }

  const despesa = new Map<string, number>();
  for (const d of expensesData ?? []) {
    despesa.set(d.distributor_id, (despesa.get(d.distributor_id) ?? 0) + Number(d.valor));
  }

  const idsComMovimento = new Set([...faturado.keys(), ...despesa.keys()]);
  const linhas = [...idsComMovimento].map((id) => {
    const f = faturado.get(id) ?? 0;
    const d = despesa.get(id) ?? 0;
    return { id, nome: nomePorId.get(id) ?? "Distribuidora", pedidos: pedidos.get(id) ?? 0, faturado: f, despesa: d, resultado: f - d };
  }).sort((a, b) => b.resultado - a.resultado);

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "40px 28px 80px" }}>
      <h1 style={{ fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-0.025em", margin: "0 0 6px" }}>Ganhos — distribuidoras</h1>
      <p style={{ color: "var(--ink-soft)", margin: "0 0 24px" }}>Faturado, despesas e resultado de cada distribuidora no período.</p>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 22 }}>
        {PERIODOS.map((p) => (
          <Link
            key={p.id}
            href={`/admin/financeiro/distribuidoras?p=${p.id}`}
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

      {linhas.length === 0 ? (
        <EmptyState titulo="Nenhum movimento no período" descricao={`Nenhuma distribuidora teve pedido entregue ou despesa em ${rotuloPeriodo(periodo).toLowerCase()}.`} />
      ) : (
        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr repeat(4, 110px)", gap: 12, padding: "0 12px 8px", fontSize: 11.5, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            <span>Distribuidora</span><span>Pedidos</span><span>Faturado</span><span>Despesas</span><span>Resultado</span>
          </div>
          {linhas.map((l) => (
            <Link
              key={l.id}
              href={`/admin/distribuidoras/${l.id}/financeiro?p=${periodo}`}
              className="card"
              style={{ display: "grid", gridTemplateColumns: "1fr repeat(4, 110px)", gap: 12, padding: "12px 16px", alignItems: "center", fontSize: 13.5 }}
            >
              <strong style={{ fontWeight: 650 }}>{l.nome}</strong>
              <span>{l.pedidos}</span>
              <span>{formatarBRL(l.faturado)}</span>
              <span>{formatarBRL(l.despesa)}</span>
              <strong>{formatarBRL(l.resultado)}</strong>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
