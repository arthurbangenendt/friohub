import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminActions } from "./AdminActions";

const mono = "var(--font-geist-mono), ui-monospace, monospace";
const SPEC_LABEL: Record<string, string> = {
  instalacao: "Instalação", manutencao: "Manutenção", remanejamento: "Remanejamento", limpeza: "Limpeza", conserto: "Conserto",
};
const STATUS_LABEL: Record<string, { label: string; cor: string; bg: string }> = {
  pendente: { label: "Pendente", cor: "var(--warm)", bg: "var(--warm-wash)" },
  em_analise: { label: "Em análise", cor: "var(--warm)", bg: "var(--warm-wash)" },
  verificado: { label: "Verificado", cor: "var(--good)", bg: "var(--cool-wash)" },
  rejeitado: { label: "Rejeitado", cor: "#b3261e", bg: "#fdeceb" },
};

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (perfil?.role !== "admin") redirect("/painel");

  const { data: pros } = await supabase
    .from("professionals")
    .select(`id, tipo, bio, cidade, estado, verification_status, created_at,
             profiles!inner ( nome ),
             professional_skills ( specialty )`)
    .order("verification_status");

  const lista = (pros ?? []).map((p) => ({
    id: p.id,
    nome: one(p.profiles)?.nome ?? "Profissional",
    tipo: p.tipo as string,
    bio: p.bio as string | null,
    cidade: p.cidade as string,
    estado: p.estado as string,
    status: p.verification_status as string,
    skills: ((p.professional_skills ?? []) as { specialty: string }[]).map((s) => s.specialty),
  }));

  const pendentes = lista.filter((p) => p.status === "pendente" || p.status === "em_analise");
  const outros = lista.filter((p) => p.status === "verificado" || p.status === "rejeitado");

  /* Distribuidoras usam o mesmo trio de colunas de confiança e a mesma dupla de
     ações — ver `definirVerificacao` em admin/actions.ts. */
  const { data: dists } = await supabase
    .from("distributors")
    .select("id, razao_social, cnpj, cidade, estado, verification_status, ativo, prazo_entrega_dias")
    .order("verification_status");

  const distribuidoras = (dists ?? []) as {
    id: string; razao_social: string; cnpj: string | null; cidade: string; estado: string;
    verification_status: string; ativo: boolean; prazo_entrega_dias: number;
  }[];
  const distPendentes = distribuidoras.filter((d) => d.verification_status === "pendente" || d.verification_status === "em_analise");

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <Link href="/painel" style={{ fontFamily: mono, fontSize: 13, color: "var(--ink-faint)" }}>← Painel</Link>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: "20px 0 6px" }}>Verificação de profissionais</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 30 }}>
        Aprove os profissionais antes que apareçam nas buscas (RISCO 4 — qualidade da rede).
      </p>

      <Secao titulo={`Aguardando análise (${pendentes.length})`}>
        {pendentes.length === 0
          ? <Vazio texto="Nenhum profissional aguardando." />
          : pendentes.map((p) => <Card key={p.id} p={p} />)}
      </Secao>

      <Secao titulo={`Já revisados (${outros.length})`}>
        {outros.length === 0
          ? <Vazio texto="Ninguém revisado ainda." />
          : outros.map((p) => <Card key={p.id} p={p} />)}
      </Secao>

      <h2 style={{ fontSize: "1.4rem", fontWeight: 800, margin: "44px 0 6px" }}>Distribuidoras</h2>
      <p style={{ color: "var(--ink-soft)", marginBottom: 24, fontSize: 14.5 }}>
        Aprovar deixa a distribuidora verificada <strong>e ativa</strong> — os produtos dela entram no
        catálogo na mesma hora.
      </p>

      <Secao titulo={`Aguardando análise (${distPendentes.length})`}>
        {distribuidoras.length === 0
          ? <Vazio texto="Nenhuma distribuidora cadastrada." />
          : distribuidoras.map((d) => <CardDist key={d.id} d={d} />)}
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

function Card({ p }: { p: { id: string; nome: string; tipo: string; bio: string | null; cidade: string; estado: string; status: string; skills: string[] } }) {
  const st = STATUS_LABEL[p.status] ?? STATUS_LABEL.pendente;
  return (
    <div className="card" style={{ padding: 18, display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 15.5 }}>{p.nome}</strong>
          <span style={{ fontSize: 11.5, color: "var(--ink-faint)", fontFamily: mono }}>{p.tipo === "empresa" ? "Empresa" : "Autônomo"}</span>
          <span style={{ fontSize: 11.5, fontFamily: mono, padding: "3px 9px", borderRadius: 100, background: st.bg, color: st.cor }}>{st.label}</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-faint)", marginTop: 4 }}>
          {p.cidade} — {p.estado} · {p.skills.map((s) => SPEC_LABEL[s] ?? s).join(", ") || "sem especialidades"}
        </div>
        {p.bio && <p style={{ fontSize: 13.5, color: "var(--ink-soft)", marginTop: 6 }}>{p.bio}</p>}
        <Link href={`/profissional/${p.id}`} target="_blank" style={{ fontSize: 12.5, color: "var(--cool-deep)", fontWeight: 600, marginTop: 6, display: "inline-block" }}>Ver perfil →</Link>
      </div>
      <AdminActions id={p.id} status={p.status} />
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
