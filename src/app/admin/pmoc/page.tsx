import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AtribuirPmocForm } from "@/app/painel/pmoc/PmocClient";

export default async function AdminPmocPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/painel");

  const [{ data: planos }, { data: pros }] = await Promise.all([
    supabase.from("pmoc_plans").select("id, company_name, site_name, cep, equipment_count, interval_months, created_at").eq("status", "requested").order("created_at"),
    supabase.from("professionals").select("id, profiles!inner(nome), professional_tags!inner(tag_slug)").eq("verification_status", "verificado").eq("professional_tags.tag_slug", "pmoc"),
  ]);
  const profissionais = (pros ?? []).map((p) => ({ id: p.id, nome: Array.isArray(p.profiles) ? p.profiles[0]?.nome ?? "Profissional" : p.profiles.nome }));

  return <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
    <Link href="/admin" style={{ color: "var(--ink-faint)", fontSize: 13 }}>← Administração</Link>
    <h1 style={{ margin: "20px 0 6px" }}>Fila PMOC</h1>
    <p style={{ color: "var(--ink-soft)", marginBottom: 28 }}>Atribua apenas profissionais verificados, com competência PMOC e cobertura do CEP. A regra final também é validada pelo banco.</p>
    <div style={{ display: "grid", gap: 12 }}>{!planos?.length && <div className="card" style={{ padding: 24, color: "var(--ink-faint)" }}>Nenhuma solicitação aguardando.</div>}{(planos ?? []).map((p) => <article className="card" style={{ padding: 18 }} key={p.id}><strong>{p.company_name} · {p.site_name}</strong><p style={{ fontSize: 13, color: "var(--ink-faint)" }}>{p.equipment_count} equipamentos · CEP {p.cep} · a cada {p.interval_months} mês(es)</p><AtribuirPmocForm planoId={p.id} profissionais={profissionais} /></article>)}</div>
  </main>;
}
