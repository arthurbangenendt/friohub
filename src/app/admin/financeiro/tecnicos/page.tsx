import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { one } from "@/lib/relacional";
import { EmptyState } from "@/components/ui";
import { PERIODOS, comoPeriodo, janela, rotuloPeriodo } from "@/lib/periodo";

/* Ranking de ganhos por técnico — soma direto de `orders`/`expenses` no
   período, agregada em JS. Mesma escala de dado de admin/financeiro (que já
   faz `.limit(5000)` em financial_postings): não há profissionais/pedidos
   suficientes ainda para justificar uma RPC agregadora (ver
   obter_receita_gmv_mensal como precedente, se o volume crescer). */

type OrderRow = { preco_servico: number; comissao_servico: number | null; jobs: { profissional_id: string } | { profissional_id: string }[] | null };

export default async function RankingTecnicosPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const sp = await searchParams;
  const periodo = comoPeriodo(sp.p);
  const { inicio, fim } = janela(periodo);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (perfil?.role !== "admin") redirect("/painel");

  const [{ data: pros }, { data: ordersData }, { data: expensesData }] = await Promise.all([
    supabase.from("professionals").select("id, profiles!inner(nome)"),
    supabase
      .from("orders")
      .select("preco_servico, comissao_servico, jobs!inner(profissional_id)")
      .eq("payment_status", "pago")
      .gte("created_at", inicio).lt("created_at", fim),
    supabase
      .from("expenses")
      .select("professional_id, valor")
      .gte("data", inicio.slice(0, 10)).lt("data", fim.slice(0, 10)),
  ]);

  const nomePorId = new Map((pros ?? []).map((p) => [p.id, one<{ nome: string }>(p.profiles)?.nome ?? "Profissional"]));

  const bruto = new Map<string, number>();
  const comissao = new Map<string, number>();
  const vendas = new Map<string, number>();
  for (const row of (ordersData ?? []) as OrderRow[]) {
    const proId = one(row.jobs)?.profissional_id;
    if (!proId) continue;
    bruto.set(proId, (bruto.get(proId) ?? 0) + Number(row.preco_servico));
    comissao.set(proId, (comissao.get(proId) ?? 0) + Number(row.comissao_servico ?? 0));
    vendas.set(proId, (vendas.get(proId) ?? 0) + 1);
  }

  const despesa = new Map<string, number>();
  for (const d of expensesData ?? []) {
    despesa.set(d.professional_id, (despesa.get(d.professional_id) ?? 0) + Number(d.valor));
  }

  const idsComMovimento = new Set([...bruto.keys(), ...despesa.keys()]);
  const linhas = [...idsComMovimento].map((id) => {
    const b = bruto.get(id) ?? 0;
    const c = comissao.get(id) ?? 0;
    const d = despesa.get(id) ?? 0;
    return { id, nome: nomePorId.get(id) ?? "Profissional", vendas: vendas.get(id) ?? 0, bruto: b, comissao: c, despesa: d, resultado: b - c - d };
  }).sort((a, b) => b.resultado - a.resultado);

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "40px 28px 80px" }}>
      <h1 style={{ fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-0.025em", margin: "0 0 6px" }}>Ganhos — técnicos</h1>
      <p style={{ color: "var(--ink-soft)", margin: "0 0 24px" }}>Bruto, comissão, despesas e resultado de cada técnico no período.</p>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 22 }}>
        {PERIODOS.map((p) => (
          <Link
            key={p.id}
            href={`/admin/financeiro/tecnicos?p=${p.id}`}
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
        <EmptyState titulo="Nenhum movimento no período" descricao={`Nenhum técnico teve pagamento liquidado ou despesa em ${rotuloPeriodo(periodo).toLowerCase()}.`} />
      ) : (
        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr repeat(4, 110px)", gap: 12, padding: "0 12px 8px", fontSize: 11.5, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            <span>Técnico</span><span>Vendas</span><span>Bruto</span><span>Despesas</span><span>Resultado</span>
          </div>
          {linhas.map((l) => (
            <Link
              key={l.id}
              href={`/admin/profissionais/${l.id}/financeiro?p=${periodo}`}
              className="card"
              style={{ display: "grid", gridTemplateColumns: "1fr repeat(4, 110px)", gap: 12, padding: "12px 16px", alignItems: "center", fontSize: 13.5 }}
            >
              <strong style={{ fontWeight: 650 }}>{l.nome}</strong>
              <span>{l.vendas}</span>
              <span>{formatarBRL(l.bruto)}</span>
              <span>{formatarBRL(l.despesa)}</span>
              <strong>{formatarBRL(l.resultado)}</strong>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
