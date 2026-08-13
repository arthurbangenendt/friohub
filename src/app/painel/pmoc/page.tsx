import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { REGIAO_SLUG } from "@/lib/regiao";
import { Cabecalho, dataCurta, mono, wrap } from "../shared";
import { comoPapel } from "../navegacao";
import { CancelarPmocForm, ConcluirVisitaForm, ResponderPmocForm, SolicitarPmocForm } from "./PmocClient";

type Visita = { id: string; due_date: string; status: string; completion_notes: string | null; completed_at: string | null };
type Plano = {
  id: string; company_name: string; site_name: string; cep: string; equipment_count: number; interval_months: number;
  price_per_visit: number | null; next_due_date: string | null; status: string; created_at: string;
  cliente: { nome: string } | { nome: string }[] | null;
  profissional: { profiles: { nome: string } | { nome: string }[] | null } | { profiles: { nome: string } | { nome: string }[] | null }[] | null;
  pmoc_visits: Visita[];
};

const status: Record<string, string> = { requested: "Aguardando atribuição", offered: "Aguardando profissional", active: "Ativo", paused: "Pausado", cancelled: "Cancelado" };
const intervalo: Record<number, string> = { 1: "mensal", 2: "bimestral", 3: "trimestral", 6: "semestral", 12: "anual" };
const one = <T,>(value: T | T[] | null): T | null => Array.isArray(value) ? value[0] ?? null : value;

export default async function PmocPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const papel = comoPapel(profile?.role);
  if (papel === "distribuidora") redirect("/painel/distribuidora");
  const { data: pmocLiberado } = await supabase.rpc("feature_enabled", {
    p_flag_key: "pmoc", p_region_slug: REGIAO_SLUG, p_subject_id: user.id,
  });
  if (!pmocLiberado && papel !== "admin") redirect("/painel");

  const { data, error } = await supabase.from("pmoc_plans").select(`id, company_name, site_name, cep, equipment_count, interval_months, price_per_visit, next_due_date, status, created_at, cliente:profiles!pmoc_plans_client_id_fkey(nome), profissional:professionals!pmoc_plans_professional_id_fkey(profiles(nome)), pmoc_visits(id, due_date, status, completion_notes, completed_at)`).order("created_at", { ascending: false });
  const planos = (data ?? []) as unknown as Plano[];

  return <div style={wrap}>
    <Cabecalho eyebrow="Manutenção recorrente" titulo="PMOC" />
    <p style={{ color: "var(--ink-soft)", maxWidth: 720, lineHeight: 1.6 }}>
      Controle recorrente de manutenção e visitas. Este módulo organiza a operação; pagamento online e emissão de documento técnico ainda não estão ativados.
    </p>
    {papel === "admin" && <Link href="/admin/pmoc" className="btn" style={{ marginBottom: 20 }}>Abrir fila administrativa</Link>}
    {papel !== "profissional" && <><h2 style={{ marginTop: 26 }}>Solicitar um plano</h2><SolicitarPmocForm /></>}
    <h2 style={{ margin: "34px 0 14px" }}>{papel === "profissional" ? "Planos atribuídos a você" : "Seus planos"}</h2>
    {error && <p style={{ color: "#b3261e" }}>Não foi possível carregar os planos.</p>}
    {!error && planos.length === 0 && <div className="card" style={{ padding: 24, color: "var(--ink-faint)" }}>Nenhum plano PMOC por aqui.</div>}
    <div style={{ display: "grid", gap: 12 }}>{planos.map((plano) => <PlanoCard key={plano.id} plano={plano} isPro={papel === "profissional"} />)}</div>
  </div>;
}

function PlanoCard({ plano, isPro }: { plano: Plano; isPro: boolean }) {
  const cliente = one(plano.cliente); const pro = one(plano.profissional); const perfilPro = pro ? one(pro.profiles) : null;
  const visitas = [...(plano.pmoc_visits ?? [])].sort((a, b) => a.due_date.localeCompare(b.due_date));
  return <article className="card" style={{ padding: 20 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div><strong style={{ fontSize: 17 }}>{plano.company_name} · {plano.site_name}</strong><div style={{ color: "var(--ink-faint)", fontSize: 13, marginTop: 4 }}>{plano.equipment_count} equipamento(s) · {intervalo[plano.interval_months]} · CEP {plano.cep}</div></div>
      <span style={{ fontFamily: mono, fontSize: 12, padding: "5px 10px", borderRadius: 99, background: "var(--surface-2)" }}>{status[plano.status] ?? plano.status}</span>
    </div>
    <p style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>{isPro ? `Cliente: ${cliente?.nome ?? "Cliente"}` : `Profissional: ${perfilPro?.nome ?? "a definir"}`}{plano.price_per_visit ? ` · ${formatarBRL(plano.price_per_visit)} por visita` : ""}</p>
    {isPro && plano.status === "offered" && <ResponderPmocForm planoId={plano.id} />}
    {visitas.length > 0 && <div style={{ borderTop: "1px solid var(--line)", marginTop: 15, paddingTop: 13 }}><strong style={{ fontSize: 13.5 }}>Visitas</strong>{visitas.map((v) => <div key={v.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}><div style={{ fontSize: 13 }}>Prevista para {dataCurta(`${v.due_date}T12:00:00`)} · {v.status === "completed" ? "Concluída" : v.status === "planned" ? "Pendente" : "Cancelada"}</div>{v.completion_notes && <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>{v.completion_notes}</p>}{isPro && v.status === "planned" && <ConcluirVisitaForm visitaId={v.id} />}</div>)}</div>}
    {!isPro && plano.status !== "cancelled" && <div style={{ marginTop: 14 }}><CancelarPmocForm planoId={plano.id} /></div>}
  </article>;
}
