import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const cor: Record<string, string> = { healthy: "var(--good)", degraded: "var(--warm)", down: "var(--danger)" };
const rotulo: Record<string, string> = { healthy: "Saudável", degraded: "Degradado", down: "Indisponível" };

export default async function SaudePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/painel");

  const { data: run } = await supabase.from("system_health_runs").select("id, status, started_at, finished_at").order("started_at", { ascending: false }).limit(1).maybeSingle();
  const { data: checks } = run
    ? await supabase.from("system_health_checks").select("component, status, observed_value, threshold, details, checked_at").eq("run_id", run.id).order("component")
    : { data: [] };

  return <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
    <Link href="/admin" style={{ color: "var(--ink-faint)", fontSize: 13 }}>← Administração</Link>
    <h1 style={{ margin: "20px 0 6px" }}>Saúde operacional</h1>
    <p style={{ color: "var(--ink-soft)", marginBottom: 26 }}>Snapshot interno atualizado pelo PostgreSQL a cada cinco minutos. Um alerta indica investigação; não substitui monitor externo.</p>
    {!run && <div className="card" style={{ padding: 22 }}>Nenhum health check executado.</div>}
    {run && <>
      <div className="card" style={{ padding: 20, borderLeft: `4px solid ${cor[run.status]}` }}><strong style={{ color: cor[run.status], fontSize: 20 }}>{rotulo[run.status] ?? run.status}</strong><div style={{ color: "var(--ink-faint)", marginTop: 5, fontSize: 13 }}>Verificado em {new Date(run.finished_at).toLocaleString("pt-BR")}</div></div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>{(checks ?? []).map((check) => <article key={check.component} className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}><div><strong>{check.component}</strong><div style={{ color: "var(--ink-faint)", fontSize: 12.5, marginTop: 3 }}>Observado: {check.observed_value ?? "—"} · limite: {check.threshold ?? "—"}</div></div><span style={{ color: cor[check.status], fontWeight: 700 }}>{rotulo[check.status] ?? check.status}</span></article>)}</div>
    </>}
  </main>;
}
