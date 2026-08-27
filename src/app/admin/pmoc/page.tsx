import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AtribuirPmocForm } from "@/app/painel/pmoc/PmocClient";
import { TOM } from "@/lib/status";

export default async function AdminPmocPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/painel");

  const hoje = new Date().toISOString().slice(0, 10);
  const [
    { data: planos }, { data: pros },
    { count: planosAtivos }, { count: visitasAtrasadas }, { count: concluidas }, { count: perdidas },
  ] = await Promise.all([
    supabase.from("pmoc_plans").select("id, company_name, site_name, cep, equipment_count, interval_months, created_at").eq("status", "requested").order("created_at"),
    supabase.from("professionals").select("id, profiles!inner(nome), professional_tags!inner(tag_slug)").eq("verification_status", "verificado").eq("professional_tags.tag_slug", "pmoc"),
    // RLS já libera pmoc_plans/pmoc_visits pra eh_admin() (20260813182838) — leitura pura, sem RPC nova.
    supabase.from("pmoc_plans").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("pmoc_visits").select("id", { count: "exact", head: true }).eq("status", "planned").lt("due_date", hoje),
    supabase.from("pmoc_visits").select("id", { count: "exact", head: true }).eq("status", "completed"),
    supabase.from("pmoc_visits").select("id", { count: "exact", head: true }).eq("status", "missed"),
  ]);
  const profissionais = (pros ?? []).map((p) => ({ id: p.id, nome: Array.isArray(p.profiles) ? p.profiles[0]?.nome ?? "Profissional" : p.profiles.nome }));

  // Amostra pequena vira ruído: 1 concluída + 1 perdida seria "50%" sem significar nada.
  const amostraConclusao = (concluidas ?? 0) + (perdidas ?? 0);
  const taxaConclusao = amostraConclusao >= 5 ? Math.round(((concluidas ?? 0) / amostraConclusao) * 100) : null;

  return <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
    <h1 style={{ margin: "0 0 6px" }}>PMOC</h1>
    <p style={{ color: "var(--ink-soft)", marginBottom: 24 }}>Saúde da carteira recorrente e fila de atribuição.</p>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 34 }}>
      <Tile label="Contratos ativos" valor={planosAtivos ?? 0} tom={TOM.andamento} />
      <Tile
        label="Visitas atrasadas"
        valor={visitasAtrasadas ?? 0}
        tom={(visitasAtrasadas ?? 0) > 0 ? TOM.erro : TOM.sucesso}
      />
      <Tile
        label="Taxa de conclusão"
        valor={taxaConclusao === null ? "—" : `${taxaConclusao}%`}
        nota={taxaConclusao === null ? "poucas visitas concluídas ainda" : undefined}
        tom={taxaConclusao === null ? TOM.neutro : taxaConclusao >= 70 ? TOM.sucesso : TOM.espera}
      />
    </div>

    <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 14 }}>Aguardando atribuição ({planos?.length ?? 0})</h2>
    <div style={{ display: "grid", gap: 12 }}>{!planos?.length && <div className="card" style={{ padding: 24, color: "var(--ink-faint)" }}>Nenhuma solicitação aguardando.</div>}{(planos ?? []).map((p) => <article className="card" style={{ padding: 18 }} key={p.id}><strong>{p.company_name} · {p.site_name}</strong><p style={{ fontSize: 13, color: "var(--ink-faint)" }}>{p.equipment_count} equipamentos · CEP {p.cep} · a cada {p.interval_months} mês(es)</p><AtribuirPmocForm planoId={p.id} profissionais={profissionais} /></article>)}</div>
  </main>;
}

function Tile({ label, valor, nota, tom }: { label: string; valor: string | number; nota?: string; tom: { cor: string; bg: string } }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>{label}</div>
      <strong style={{ display: "block", fontSize: 24, marginTop: 3, color: tom.cor }}>{valor}</strong>
      {nota && <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{nota}</span>}
    </div>
  );
}
