import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { rotuloJob } from "@/app/solicitar/tipos";
import { Check, Star } from "@/components/icons";
import { mono, one, wrap } from "../../../shared";

type Proposta = {
  id: string; professional_id: string; tipo: string; valor_mao_obra: number; valor_materiais: number; valor_visita: number;
  visita_abatida: boolean; inclui: string | null; nao_inclui: string | null; prazo_execucao: string | null;
  garantia_dias: number; validade_ate: string; observacoes: string | null; status: string;
  profissional: unknown;
};

export default async function CompararPropostasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/login");
  const { data: pedido } = await supabase.from("quote_requests").select("id, cliente_id, job_type, status").eq("id", id).maybeSingle();
  if (!pedido || pedido.cliente_id !== user.id) redirect(`/painel/orcamentos/${id}`);
  const { data } = await supabase.from("quotes").select(`id, professional_id, tipo, valor_mao_obra, valor_materiais, valor_visita, visita_abatida, inclui, nao_inclui, prazo_execucao, garantia_dias, validade_ate, observacoes, status, profissional:professionals(profiles(nome), professional_skills(rating_avg, rating_count, jobs_completed))`).eq("quote_request_id", id).in("status", ["enviada", "aceita"]).order("created_at");
  const propostas = (data ?? []) as unknown as Proposta[];
  return <div style={{ ...wrap, maxWidth: 1100 }}>
    <Link href={`/painel/orcamentos/${id}`} style={{ fontFamily: mono, fontSize: 13, color: "var(--ink-faint)" }}>← Voltar ao pedido</Link>
    <h1 style={{ margin: "20px 0 5px", fontSize: "1.75rem" }}>Compare as propostas</h1>
    <p style={{ color: "var(--ink-soft)", margin: "0 0 24px" }}>{rotuloJob(pedido.job_type)} · compare escopo, garantia, experiência e preço. Menor preço não significa automaticamente melhor escolha.</p>
    {propostas.length < 2 && <div className="card" style={{ padding: 24 }}>O comparador fica mais útil quando há pelo menos duas propostas. Você pode revisar a proposta disponível no pedido.</div>}
    {propostas.length >= 2 && <div style={{ overflowX: "auto", paddingBottom: 8 }}><div style={{ display: "grid", gridTemplateColumns: `150px repeat(${propostas.length}, minmax(230px, 1fr))`, minWidth: 150 + propostas.length * 230, border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
      <Celula cabecalho>Critério</Celula>{propostas.map((p) => { const info = infoPro(p); return <Celula cabecalho key={p.id}><strong>{info.nome}</strong><span style={{ display: "flex", gap: 5, alignItems: "center", marginTop: 6, color: "var(--warm)" }}><Star size={14} filled /> {info.nota ?? "nova"}</span></Celula>; })}
      <Celula>Total</Celula>{propostas.map((p) => <Celula key={`${p.id}-total`} destaque><strong>{formatarBRL(total(p))}</strong><small>{p.tipo === "visita_tecnica" ? "visita técnica" : "preço fechado"}</small></Celula>)}
      <Celula>Inclui</Celula>{propostas.map((p) => <Celula key={`${p.id}-inclui`}>{p.inclui || "Não detalhado"}</Celula>)}
      <Celula>Não inclui</Celula>{propostas.map((p) => <Celula key={`${p.id}-fora`}>{p.nao_inclui || "Não informado"}</Celula>)}
      <Celula>Garantia</Celula>{propostas.map((p) => <Celula key={`${p.id}-garantia`}>{p.garantia_dias > 0 ? `${p.garantia_dias} dias` : "Não informada"}</Celula>)}
      <Celula>Prazo</Celula>{propostas.map((p) => <Celula key={`${p.id}-prazo`}>{p.prazo_execucao || "A combinar"}</Celula>)}
      <Celula>Experiência</Celula>{propostas.map((p) => { const info = infoPro(p); return <Celula key={`${p.id}-exp`}>{info.servicos} serviços concluídos</Celula>; })}
      <Celula>Observação</Celula>{propostas.map((p) => <Celula key={`${p.id}-obs`}>{p.observacoes || "—"}</Celula>)}
      <Celula>Próximo passo</Celula>{propostas.map((p) => <Celula key={`${p.id}-acao`}><Link href={`/painel/orcamentos/${id}#propostas`} className="btn btn-primary" style={{ height: 38, fontSize: 13 }}>Revisar e escolher</Link></Celula>)}
    </div></div>}
    <div className="card" style={{ marginTop: 16, padding: 18 }}><strong style={{ display: "flex", alignItems: "center", gap: 7 }}><Check size={16} /> Antes de escolher</strong><p style={{ margin: "7px 0 0", color: "var(--ink-soft)", fontSize: 13.5 }}>Confirme o que está incluído, materiais, prazo, garantia e se uma visita será abatida do serviço. Use o chat para esclarecer qualquer item vazio.</p></div>
  </div>;
}

function total(p: Proposta) { return Number(p.valor_mao_obra) + Number(p.valor_materiais) + (p.tipo === "visita_tecnica" ? Number(p.valor_visita) : 0); }
function infoPro(p: Proposta) {
  const pro = one(p.profissional as { profiles: unknown; professional_skills: unknown } | null);
  const perfil = one(pro?.profiles) as { nome: string } | null;
  const skills = (pro?.professional_skills ?? []) as { rating_avg: number; rating_count: number; jobs_completed: number }[];
  const n = skills.reduce((s, x) => s + x.rating_count, 0);
  const nota = n ? (skills.reduce((s, x) => s + Number(x.rating_avg) * x.rating_count, 0) / n).toFixed(1) : null;
  return { nome: perfil?.nome ?? "Profissional", nota, servicos: skills.reduce((s, x) => s + x.jobs_completed, 0) };
}
function Celula({ children, cabecalho = false, destaque = false }: { children: React.ReactNode; cabecalho?: boolean; destaque?: boolean }) { return <div style={{ padding: 14, borderRight: "1px solid var(--line)", borderBottom: "1px solid var(--line)", background: cabecalho ? "var(--surface-2)" : destaque ? "var(--cool-wash)" : "var(--surface)", fontSize: 13.5, display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>; }
