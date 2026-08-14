import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ExecutionForm } from "./ExecutionForm";
import { featureHabilitada } from "@/lib/feature-flags";

export default async function ExecutarServicoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: job } = await supabase.from("jobs").select("id, job_type, profissional_id").eq("id", id).maybeSingle();
  if (!job || job.profissional_id !== user.id) redirect(`/servico/${id}`);
  const { data: execution } = await supabase.from("service_executions").select("checklist, materials, measurements, evidence_paths, notes, warranty_until, maintenance_due, status, template:service_checklist_templates(title, items)").eq("job_id", id).maybeSingle();
  const podeIniciarExecucao = await featureHabilitada(supabase, "ux_execution", user.id);
  // Uma redução de rollout bloqueia novas execuções, mas não abandona o técnico
  // no meio de um atendimento que já possui rascunho.
  if (!podeIniciarExecucao && !execution) redirect(`/servico/${id}`);
  let template = Array.isArray(execution?.template) ? execution.template[0] : execution?.template;
  if (!template) { const { data } = await supabase.from("service_checklist_templates").select("title, items").eq("active", true).in("job_type", [job.job_type, "outro"]).order("job_type").limit(1).maybeSingle(); template = data; }
  return <main className="container-tight" style={{ padding: "40px 24px 80px" }}><Link href={`/servico/${id}`} style={{ color: "var(--ink-faint)" }}>← Voltar ao serviço</Link><h1 style={{ margin: "20px 0 5px" }}>Modo execução</h1><p style={{ color: "var(--ink-soft)", marginBottom: 24 }}>{template?.title ?? "Atendimento técnico"} · o rascunho fica disponível para retomada.</p><ExecutionForm jobId={id} userId={user.id} items={(template?.items ?? []) as { key: string; label: string }[]} draft={execution as never} /></main>;
}
