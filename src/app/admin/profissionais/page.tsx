import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminActions } from "../AdminActions";
import { STATUS_VERIFICACAO, resolverMapa } from "@/lib/status";
import { one } from "@/lib/relacional";
import { Alert } from "@/components/ui";

const mono = "var(--font-geist-mono), ui-monospace, monospace";
const SPEC_LABEL: Record<string, string> = {
  instalacao: "Instalação", manutencao: "Manutenção", remanejamento: "Remanejamento", limpeza: "Limpeza", conserto: "Conserto",
};
const STATUS_LABEL = resolverMapa(STATUS_VERIFICACAO);

export default async function AdminProfissionaisPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (perfil?.role !== "admin") redirect("/painel");

  /* Erro de busca não pode virar "ninguém aguardando" em silêncio — mesmo
     cuidado já registrado em admin/financeiro/page.tsx: um `?? []` sozinho
     esconde RLS/coluna/embed quebrado atrás de uma lista vazia legítima.

     `documento_storage_path` NÃO entra neste select: a coluna nunca esteve
     no grant público de `professionals` (20260814114010_rest_api_role_grants
     só libera um allowlist pra vitrine) — mesma sensibilidade que já levava
     o arquivo em si a exigir RLS de storage dedicada. É lida à parte, por
     profissional, via `obter_documento_verificacao` (admin-only). */
  const { data: pros, error: erroPros } = await supabase
    .from("professionals")
    .select(`id, tipo, bio, cidade, estado, verification_status, created_at,
             profiles!inner ( nome ),
             professional_skills ( specialty )`)
    .order("verification_status");

  /* Signed URL gerada com a sessão do próprio admin — a RLS de
     `documentos-verificacao` (pode_ler_documento_verificacao) decide se ele
     pode, sem precisar de service-role nem rota nova. */
  const lista = await Promise.all((pros ?? []).map(async (p) => {
    const { data: caminho } = await supabase.rpc("obter_documento_verificacao", { p_professional_id: p.id });
    let documentoUrl: string | null = null;
    if (caminho) {
      const { data } = await supabase.storage
        .from("documentos-verificacao")
        .createSignedUrl(caminho, 3600);
      documentoUrl = data?.signedUrl ?? null;
    }
    return {
      id: p.id,
      nome: one(p.profiles)?.nome ?? "Profissional",
      tipo: p.tipo as string,
      bio: p.bio as string | null,
      cidade: p.cidade as string,
      estado: p.estado as string,
      status: p.verification_status as string,
      skills: ((p.professional_skills ?? []) as { specialty: string }[]).map((s) => s.specialty),
      documentoUrl,
    };
  }));

  const pendentes = lista.filter((p) => p.status === "pendente" || p.status === "em_analise");
  const outros = lista.filter((p) => p.status === "verificado" || p.status === "rejeitado");

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: "0 0 6px" }}>Verificação de profissionais</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 30 }}>
        Aprove os profissionais antes que apareçam nas buscas (RISCO 4 — qualidade da rede).
      </p>

      {erroPros && (
        <Alert tipo="erro" titulo="Não foi possível carregar os profissionais">
          {erroPros.message}
        </Alert>
      )}

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
    </main>
  );
}

function Card({ p }: { p: { id: string; nome: string; tipo: string; bio: string | null; cidade: string; estado: string; status: string; skills: string[]; documentoUrl: string | null } }) {
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
        <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
          <Link href={`/profissional/${p.id}`} target="_blank" style={{ fontSize: 12.5, color: "var(--cool-deep)", fontWeight: 600 }}>Ver perfil →</Link>
          <Link href={`/admin/profissionais/${p.id}/financeiro`} style={{ fontSize: 12.5, color: "var(--cool-deep)", fontWeight: 600 }}>Ver financeiro →</Link>
          {p.documentoUrl ? (
            <a href={p.documentoUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: "var(--cool-deep)", fontWeight: 600 }}>Ver documento →</a>
          ) : (
            <span style={{ fontSize: 12.5, color: "var(--danger)" }}>Sem documento enviado</span>
          )}
        </div>
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
