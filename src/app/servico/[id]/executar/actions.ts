"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { featureHabilitada } from "@/lib/feature-flags";

export type ExecutionState = { ok: boolean; message: string };

async function podeContinuarExecucao(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  jobId: string,
) {
  if (await featureHabilitada(supabase, "ux_execution", userId)) return true;
  const { data: execution } = await supabase
    .from("service_executions")
    .select("id")
    .eq("job_id", jobId)
    .maybeSingle();
  return Boolean(execution);
}

export async function salvarExecucao(_: ExecutionState, formData: FormData): Promise<ExecutionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sua sessão expirou." };
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId || !await podeContinuarExecucao(supabase, user.id, jobId)) return { ok: false, message: "O modo execução não está disponível para sua conta." };
  const checklist = Object.fromEntries([...formData.entries()].filter(([key]) => key.startsWith("checklist:")).map(([key]) => [key.slice(10), true]));
  const materials = String(formData.get("materials") ?? "").split("\n").map((description) => description.trim()).filter(Boolean).slice(0, 50).map((description) => ({ description }));
  const measurements = { temperatura: String(formData.get("temperatura") ?? "").trim(), pressao: String(formData.get("pressao") ?? "").trim() };
  let evidencePaths: string[] = [];
  try { evidencePaths = JSON.parse(String(formData.get("evidencePaths") ?? "[]")); } catch { return { ok: false, message: "Lista de evidências inválida." }; }
  if (!Array.isArray(evidencePaths) || evidencePaths.some((path) => typeof path !== "string" || !path.startsWith(`${user.id}/${jobId}/`))) return { ok: false, message: "Evidência inválida." };
  const { error } = await supabase.rpc("salvar_execucao_servico", {
    p_job_id: jobId, p_checklist: checklist, p_materials: materials, p_measurements: measurements,
    p_evidence_paths: evidencePaths, p_notes: String(formData.get("notes") ?? ""),
    // O gerador tipa argumentos SQL `date` como obrigatórios mesmo aceitando
    // NULL no Postgres; o cast mantém o payload real nullable.
    p_warranty_until: (String(formData.get("warrantyUntil") ?? "") || null) as string,
    p_maintenance_due: (String(formData.get("maintenanceDue") ?? "") || null) as string,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/servico/${jobId}`); revalidatePath(`/servico/${jobId}/executar`);
  return { ok: true, message: "Rascunho salvo. Você pode continuar depois." };
}

export async function finalizarExecucao(_: ExecutionState, formData: FormData): Promise<ExecutionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sua sessão expirou." };
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId || !await podeContinuarExecucao(supabase, user.id, jobId)) return { ok: false, message: "O modo execução não está disponível para sua conta." };
  const { error } = await supabase.rpc("finalizar_execucao_servico", { p_job_id: jobId });
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/servico/${jobId}`); revalidatePath(`/servico/${jobId}/executar`);
  return { ok: true, message: "Relatório finalizado e compartilhado com o cliente." };
}
