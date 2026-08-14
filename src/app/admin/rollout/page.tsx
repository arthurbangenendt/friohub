import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RolloutForm } from "./RolloutForm";

const LABEL: Record<string, string> = { ux_pipeline: "Pipeline e confiança", ux_execution: "Execução profissional", ux_portfolio: "Carteira e recorrência", ux_growth: "Gestão e crescimento" };

export default async function RolloutPage() {
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/painel");
  const { data: flags } = await supabase.from("feature_flags").select("flag_key, description, enabled, rollout_percentage, region:marketplace_regions(slug, city, state)").in("flag_key", Object.keys(LABEL)).order("flag_key");
  return <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
    <Link href="/admin" style={{ color: "var(--ink-faint)", fontSize: 13 }}>← Administração</Link>
    <h1 style={{ margin: "20px 0 6px" }}>Rollout das experiências</h1>
    <p style={{ color: "var(--ink-soft)", lineHeight: 1.6 }}>O mesmo UUID permanece sempre no mesmo grupo. Desativar bloqueia menus, páginas e comandos da aplicação para novas jornadas. Atendimentos com execução já iniciada podem ser concluídos. Toda alteração exige justificativa e entra no log administrativo.</p>
    <div role="note" style={{ marginTop: 16, padding: 14, borderRadius: 10, background: "var(--warm-wash)", color: "var(--ink-soft)", fontSize: 13.5, lineHeight: 1.55 }}>
      Feature flags controlam liberação de produto, não autorização de dados. Reduza percentuais gradualmente e acompanhe erros e conversão antes de desativar totalmente.
    </div>
    <div style={{ display: "grid", gap: 14, marginTop: 24 }}>{(flags ?? []).map((flag) => { const region = Array.isArray(flag.region) ? flag.region[0] : flag.region; if (!region) return null; return <section key={`${flag.flag_key}-${region.slug}`} className="card" style={{ padding: 20 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><div><strong>{LABEL[flag.flag_key] ?? flag.flag_key}</strong><p style={{ margin: "4px 0 0", color: "var(--ink-faint)", fontSize: 13 }}>{flag.description} · {region.city}/{region.state}</p></div><span style={{ color: flag.enabled ? "var(--good)" : "#b3261e", fontSize: 13 }}>{flag.enabled ? `${flag.rollout_percentage}%` : "Desativada"}</span></div><RolloutForm flagKey={flag.flag_key} regionSlug={region.slug} enabled={flag.enabled} rollout={flag.rollout_percentage}/></section>; })}</div>
  </main>;
}
