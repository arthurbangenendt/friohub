import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";

/* Demanda por plano — visão da operação.
 *
 * `city_billing_config.cobranca_ativa` liga cidade por cidade — hoje já vale
 * para São Paulo (20260818145000_ligar_cobranca_sao_paulo_sandbox.sql), então
 * ASSINATURA já é um fato do sistema ali, não só intenção. Onde a cobrança
 * ainda está desligada (cold start de uma cidade nova), o que existe é
 * INTENÇÃO (`plan_interest`), registrada quando o parceiro escolhe um plano
 * em /planos. Esta tela mostra os dois números, sem confundir um com o outro.
 *
 * A leitura de `plan_interest` depende da policy `plan_interest_admin_read`
 * (20260813200000_plan_interest_admin.sql). Sem ela o admin enxerga zero. */

export const metadata = { title: "Assinaturas — Administração" };

const mono = "var(--font-geist-mono), ui-monospace, monospace";

const dataHora = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

type Interesse = {
  id: string;
  ciclo: string;
  created_at: string;
  professional_id: string;
  subscription_plans: {
    nome: string;
    slug: string | null;
    preco_mensal: number;
    preco_anual: number | null;
  } | null;
};

export default async function AssinaturasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: perfil } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (perfil?.role !== "admin") redirect("/painel");

  const { data: bruto } = await supabase
    .from("plan_interest")
    .select(
      "id, ciclo, created_at, professional_id, subscription_plans ( nome, slug, preco_mensal, preco_anual )",
    )
    .order("created_at", { ascending: false });

  const interesses = (bruto ?? []) as unknown as Interesse[];

  // Nomes em lote — nada de consulta por linha.
  const ids = [...new Set(interesses.map((i) => i.professional_id))];
  const { data: perfis } = ids.length
    ? await supabase.from("profiles").select("id, nome").in("id", ids)
    : { data: [] };
  const nomePorId = new Map((perfis ?? []).map((p) => [p.id, p.nome]));

  /* Receita potencial conta cada profissional UMA vez, pela escolha mais
     recente. Somar todas as linhas inflaria o número de quem trocou de ideia
     entre planos — e um número inflado aqui vira decisão errada de roadmap. */
  const ultimaPorPro = new Map<string, Interesse>();
  for (const i of interesses) if (!ultimaPorPro.has(i.professional_id)) ultimaPorPro.set(i.professional_id, i);
  const escolhas = [...ultimaPorPro.values()];

  const mensalEquivalente = (i: Interesse) => {
    const p = i.subscription_plans;
    if (!p) return 0;
    return i.ciclo === "anual" ? Number(p.preco_anual ?? p.preco_mensal * 10) / 12 : Number(p.preco_mensal);
  };
  const receitaPotencial = escolhas.reduce((s, i) => s + mensalEquivalente(i), 0);

  const porPlano = new Map<string, { nome: string; n: number; receita: number }>();
  for (const i of escolhas) {
    const nome = i.subscription_plans?.nome ?? "—";
    const at = porPlano.get(nome) ?? { nome, n: 0, receita: 0 };
    at.n += 1;
    at.receita += mensalEquivalente(i);
    porPlano.set(nome, at);
  }
  const ranking = [...porPlano.values()].sort((a, b) => b.receita - a.receita);
  const anuais = escolhas.filter((i) => i.ciclo === "anual").length;

  /* Assinatura de verdade — conta quem já saiu de 'gratis' porque a cobrança
     está ligada na própria cidade. O bloco só aparece quando esse número for
     maior que zero, em vez de mostrar uma fileira de zeros nas cidades onde a
     cobrança ainda não foi ligada. */
  const { count: pagantes } = await supabase
    .from("professionals")
    .select("id", { count: "exact", head: true })
    .in("subscription_status", ["ativa", "trial", "inadimplente"]);

  const { data: cidadesCobranca } = await supabase
    .from("city_billing_config")
    .select("cidade")
    .eq("cobranca_ativa", true);
  const cobrancaLigadaEm = (cidadesCobranca ?? []).map((c) => c.cidade);

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <h1 style={{ margin: "0 0 6px" }}>Assinaturas</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 26, lineHeight: 1.6 }}>
        {cobrancaLigadaEm.length > 0
          ? <>A cobrança já está ligada em <strong>{cobrancaLigadaEm.join(", ")}</strong> — veja assinantes reais
              abaixo. O restante da tela é a <strong>intenção registrada</strong> em /planos, incluindo cidades
              onde a cobrança ainda não foi ligada.</>
          : <>A cobrança ainda não está ligada em nenhuma cidade, então ninguém paga nada. O que esta tela
              mostra é a <strong>intenção registrada</strong> — quem escolheu qual plano em /planos. É o número
              que decide se vale ligar a cobrança.</>}
      </p>

      {interesses.length === 0 ? (
        <div className="card" style={{ padding: 26 }}>
          <strong style={{ display: "block", marginBottom: 6 }}>Nenhum interesse registrado ainda.</strong>
          <span style={{ color: "var(--ink-soft)", fontSize: 14, lineHeight: 1.6 }}>
            Vale checar se a página está alcançável: hoje <code>/planos</code> não tem link no menu
            do site nem no painel, então o parceiro só chega digitando a URL. Sem porta de entrada,
            este número não sai do zero.
          </span>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <Cartao rotulo="Profissionais" valor={String(escolhas.length)} nota="escolheram um plano" />
            <Cartao
              rotulo="Receita potencial"
              valor={formatarBRL(receitaPotencial)}
              nota="por mês, se todos pagassem"
            />
            <Cartao
              rotulo="Preferem anual"
              valor={`${escolhas.length ? Math.round((anuais / escolhas.length) * 100) : 0}%`}
              nota={`${anuais} de ${escolhas.length}`}
            />
          </div>

          <h2 style={{ fontSize: "1.05rem", margin: "30px 0 12px" }}>Por plano</h2>
          <div style={{ display: "grid", gap: 8 }}>
            {ranking.map((p) => {
              const pct = escolhas.length ? (p.n / escolhas.length) * 100 : 0;
              return (
                <article key={p.nome} className="card" style={{ padding: "14px 18px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline" }}>
                    <strong>{p.nome}</strong>
                    <span style={{ fontFamily: mono, fontSize: 13, color: "var(--ink-soft)" }}>
                      {p.n} · {formatarBRL(p.receita)}/mês
                    </span>
                  </div>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 999,
                      background: "var(--surface-2)",
                      marginTop: 10,
                      overflow: "hidden",
                    }}
                  >
                    <div style={{ width: `${pct}%`, height: "100%", background: "var(--chart-1)" }} />
                  </div>
                </article>
              );
            })}
          </div>

          <h2 style={{ fontSize: "1.05rem", margin: "30px 0 12px" }}>Quem escolheu</h2>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 520 }}>
              <thead>
                <tr>
                  {["Profissional", "Plano", "Ciclo", "Quando"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: "11px 16px",
                        fontSize: 12,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "var(--ink-soft)",
                        borderBottom: "1px solid var(--line)",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {interesses.map((i) => (
                  <tr key={i.id}>
                    <td style={celula}>
                      <Link href={`/profissional/${i.professional_id}`} style={{ color: "var(--cool)", fontWeight: 600 }}>
                        {nomePorId.get(i.professional_id) ?? "Profissional"}
                      </Link>
                    </td>
                    <td style={celula}>{i.subscription_plans?.nome ?? "—"}</td>
                    <td style={{ ...celula, textTransform: "capitalize" }}>{i.ciclo}</td>
                    <td style={{ ...celula, fontFamily: mono, fontSize: 12.5, color: "var(--ink-soft)" }}>
                      {dataHora(i.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: 12, fontSize: 12.5, color: "var(--ink-faint)", lineHeight: 1.6 }}>
            A lista traz todo o histórico, inclusive quem trocou de plano. Os totais acima contam
            cada profissional uma vez, pela escolha mais recente.
          </p>
        </>
      )}

      {(pagantes ?? 0) > 0 && (
        <div className="card" style={{ padding: 20, marginTop: 26, borderLeft: "4px solid var(--good)" }}>
          <strong>{pagantes} com assinatura ativa (cobrança real)</strong>
          <div style={{ color: "var(--ink-soft)", fontSize: 13.5, marginTop: 4 }}>
            Profissionais com `professionals.subscription_status` em ativa, trial ou inadimplente —
            dinheiro de verdade passando pelo Asaas, não intenção. Ver <Link href="/admin/financeiro" style={{ color: "var(--cool)" }}>/admin/financeiro</Link> para o ledger completo.
          </div>
        </div>
      )}
    </main>
  );
}

const celula = {
  padding: "11px 16px",
  borderBottom: "1px solid var(--line-soft)",
} as const;

function Cartao({ rotulo, valor, nota }: { rotulo: string; valor: string; nota: string }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-faint)" }}>
        {rotulo}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", margin: "4px 0 2px" }}>{valor}</div>
      <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>{nota}</div>
    </div>
  );
}
