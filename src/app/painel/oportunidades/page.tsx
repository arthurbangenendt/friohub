import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { rotuloJob } from "@/app/solicitar/tipos";
import { Cabecalho, dataCurta, mono, wrap } from "../shared";
import { ConcluirFollowUpForm, CriarFollowUpForm } from "./FollowUpForms";

type Etapa = "novo" | "visualizado" | "proposta" | "ganho" | "perdido";
const ETAPA: Record<Etapa, { label: string; cor: string }> = {
  novo: { label: "Novo", cor: "var(--warm)" }, visualizado: { label: "Visualizado", cor: "var(--cool)" },
  proposta: { label: "Proposta enviada", cor: "var(--cool-deep)" }, ganho: { label: "Ganho", cor: "var(--good)" },
  perdido: { label: "Encerrado", cor: "var(--ink-faint)" },
};

export default async function OportunidadesPage() {
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "profissional") redirect("/painel");
  const { data: targets } = await supabase.from("quote_request_targets").select("quote_request_id, enviado_em, visto_em, recusado_em, pedido:quote_requests(id, job_type, bairro, cep, urgencia, status, expira_em)").eq("professional_id", user.id).order("enviado_em", { ascending: false }).limit(100);
  const ids = (targets ?? []).map((t) => t.quote_request_id);
  const [{ data: quotes }, { data: tasks }] = ids.length ? await Promise.all([
    supabase.from("quotes").select("id, quote_request_id, status, tipo, valor_mao_obra, valor_materiais, valor_visita, created_at").eq("professional_id", user.id).in("quote_request_id", ids),
    supabase.from("follow_up_tasks").select("id, quote_request_id, title, due_at, status").eq("professional_id", user.id).eq("status", "pending").in("quote_request_id", ids),
  ]) : [{ data: [] }, { data: [] }];
  const quotePorPedido = new Map((quotes ?? []).map((q) => [q.quote_request_id, q]));
  const taskPorPedido = new Map((tasks ?? []).map((t) => [t.quote_request_id, t]));
  const oportunidades = (targets ?? []).map((target) => {
    const pedido = Array.isArray(target.pedido) ? target.pedido[0] : target.pedido;
    const quote = quotePorPedido.get(target.quote_request_id); const task = taskPorPedido.get(target.quote_request_id);
    let etapa: Etapa = !target.visto_em ? "novo" : "visualizado";
    if (target.recusado_em || pedido?.status === "cancelado" || pedido?.status === "expirado" || quote?.status === "recusada") etapa = "perdido";
    else if (quote?.status === "aceita") etapa = "ganho"; else if (quote) etapa = "proposta";
    const valor = quote ? Number(quote.valor_mao_obra) + Number(quote.valor_materiais) + (quote.tipo === "visita_tecnica" ? Number(quote.valor_visita) : 0) : null;
    return { target, pedido, quote, task, etapa, valor };
  });
  const contagem = (Object.keys(ETAPA) as Etapa[]).map((e) => [e, oportunidades.filter((o) => o.etapa === e).length] as const);
  return <div style={wrap}><Cabecalho eyebrow="Comercial" titulo="Oportunidades" />
    <p style={{ color: "var(--ink-soft)", lineHeight: 1.6 }}>A etapa vem do pedido e da proposta. O follow-up organiza sua próxima ação sem alterar o estado real da negociação.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 9, margin: "22px 0" }}>{contagem.map(([e, n]) => <div className="card" key={e} style={{ padding: 14, borderTop: `3px solid ${ETAPA[e].cor}` }}><span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{ETAPA[e].label}</span><strong style={{ display: "block", fontSize: 23, marginTop: 3 }}>{n}</strong></div>)}</div>
    <div style={{ display: "grid", gap: 11 }}>{oportunidades.length === 0 && <div className="card" style={{ padding: 26, color: "var(--ink-faint)" }}>Nenhuma oportunidade recebida ainda.</div>}{oportunidades.map(({ target, pedido, task, etapa, valor }) => <article key={target.quote_request_id} className="card" style={{ padding: 18, borderLeft: `3px solid ${ETAPA[etapa].cor}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><span style={{ fontFamily: mono, color: ETAPA[etapa].cor, fontSize: 11.5 }}>{ETAPA[etapa].label}</span><h2 style={{ fontSize: 16, margin: "5px 0 3px" }}>{pedido ? rotuloJob(pedido.job_type) : "Pedido"}</h2><span style={{ fontSize: 13, color: "var(--ink-faint)" }}>{pedido?.bairro ? `${pedido.bairro} · ` : ""}{pedido?.cep ?? ""} · recebido {dataCurta(target.enviado_em)}</span></div>{valor !== null && <strong>{formatarBRL(valor)}</strong>}</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}><Link href={`/painel/orcamentos/${target.quote_request_id}`} style={{ color: "var(--cool-deep)", fontWeight: 650, fontSize: 13 }}>Abrir oportunidade →</Link></div>
      {task ? <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: new Date(task.due_at) < new Date() ? "#fdeceb" : "var(--surface-2)" }}><strong style={{ fontSize: 13 }}>{task.title}</strong><span style={{ display: "block", fontSize: 12, color: "var(--ink-faint)", marginTop: 2 }}>{new Date(task.due_at).toLocaleString("pt-BR")}</span><ConcluirFollowUpForm taskId={task.id} dueAt={task.due_at} /></div> : !["ganho", "perdido"].includes(etapa) && <CriarFollowUpForm pedidoId={target.quote_request_id} />}
    </article>)}</div>
  </div>;
}
