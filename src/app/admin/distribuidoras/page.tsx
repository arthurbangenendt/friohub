import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminActions } from "../AdminActions";
import { STATUS_VERIFICACAO, resolverMapa } from "@/lib/status";

const mono = "var(--font-geist-mono), ui-monospace, monospace";
const STATUS_LABEL = resolverMapa(STATUS_VERIFICACAO);

export default async function AdminDistribuidorasPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (perfil?.role !== "admin") redirect("/painel");

  /* Distribuidoras usam o mesmo trio de colunas de confiança e a mesma dupla de
     ações — ver `definirVerificacao` em admin/actions.ts. */
  const { data: dists } = await supabase
    .from("distributors")
    .select("id, razao_social, cidade, estado, verification_status, ativo, prazo_entrega_dias")
    .order("verification_status");

  const distribuidoras = await Promise.all((dists ?? []).map(async (dist) => {
    const { data: cnpj } = await supabase.rpc("obter_cnpj_distribuidora", {
      p_distributor_id: dist.id,
    });
    return { ...dist, cnpj };
  }));
  const pendentes = distribuidoras.filter((d) => d.verification_status === "pendente" || d.verification_status === "em_analise");
  const outros = distribuidoras.filter((d) => d.verification_status === "verificado" || d.verification_status === "rejeitado");

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: "0 0 6px" }}>Distribuidoras</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 30 }}>
        Aprovar deixa a distribuidora verificada <strong>e ativa</strong> — os produtos dela entram no
        catálogo na mesma hora.
      </p>

      <Secao titulo={`Aguardando análise (${pendentes.length})`}>
        {pendentes.length === 0
          ? <Vazio texto="Nenhuma distribuidora aguardando." />
          : pendentes.map((d) => <CardDist key={d.id} d={d} />)}
      </Secao>

      <Secao titulo={`Já revisadas (${outros.length})`}>
        {outros.length === 0
          ? <Vazio texto="Nenhuma revisada ainda." />
          : outros.map((d) => <CardDist key={d.id} d={d} />)}
      </Secao>
    </main>
  );
}

function CardDist({ d }: {
  d: { id: string; razao_social: string; cnpj: string | null; cidade: string; estado: string; verification_status: string; ativo: boolean; prazo_entrega_dias: number };
}) {
  const st = STATUS_LABEL[d.verification_status] ?? STATUS_LABEL.pendente;
  return (
    <div className="card" style={{ padding: 18, display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 15.5 }}>{d.razao_social}</strong>
          <span style={{ fontSize: 11.5, fontFamily: mono, padding: "3px 9px", borderRadius: 100, background: st.bg, color: st.cor }}>{st.label}</span>
          {d.verification_status === "verificado" && !d.ativo && (
            <span style={{ fontSize: 11.5, fontFamily: mono, color: "var(--warm)" }}>inativa</span>
          )}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-faint)", marginTop: 4 }}>
          {d.cidade} — {d.estado} · entrega em {d.prazo_entrega_dias} dia(s)
          {d.cnpj ? ` · CNPJ ${d.cnpj}` : " · sem CNPJ informado"}
        </div>
      </div>
      <AdminActions id={d.id} status={d.verification_status} tipo="distribuidora" />
    </div>
  );
}
function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 34 }}>
      <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 14 }}>{titulo}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </section>
  );
}
function Vazio({ texto }: { texto: string }) {
  return <div style={{ padding: "20px", borderRadius: 12, border: "1px dashed var(--line)", color: "var(--ink-faint)", fontSize: 14, textAlign: "center" }}>{texto}</div>;
}
