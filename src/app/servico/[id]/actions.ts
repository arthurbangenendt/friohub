"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const SPEC_OF: Record<string, string> = {
  instalacao_com_equipamento: "instalacao",
  manutencao: "manutencao",
  remanejamento: "remanejamento",
  limpeza: "limpeza",
  conserto: "conserto",
};

// Avança o status do job — só o profissional dono, e só a partir do estado esperado.
async function avancar(jobId: string, de: string, para: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { data, error } = await supabase
    .from("jobs")
    .update({ status: para })
    .eq("id", jobId)
    .eq("profissional_id", user.id)
    .eq("status", de)
    .select("id")
    .single();

  if (error || !data) return { ok: false as const, error: error?.message ?? "Não foi possível atualizar." };
  revalidatePath(`/servico/${jobId}`);
  revalidatePath("/painel");
  return { ok: true as const };
}

export async function aceitarJob(jobId: string) {
  return avancar(jobId, "aguardando_profissional", "aceito");
}
export async function iniciarJob(jobId: string) {
  return avancar(jobId, "aceito", "em_execucao");
}
export async function concluirJob(jobId: string) {
  return avancar(jobId, "em_execucao", "concluido");
}

export async function avaliarJob(input: { jobId: string; rating: number; comment: string }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { data: job } = await supabase
    .from("jobs")
    .select("id, job_type, profissional_id, cliente_id, status")
    .eq("id", input.jobId)
    .single();

  if (!job) return { ok: false as const, error: "Serviço não encontrado." };
  if (job.cliente_id !== user.id) return { ok: false as const, error: "Apenas o cliente pode avaliar." };
  if (job.status !== "concluido") return { ok: false as const, error: "O serviço ainda não foi concluído." };
  if (!job.profissional_id) return { ok: false as const, error: "Serviço sem profissional." };

  const specialty = SPEC_OF[job.job_type] ?? "instalacao";
  const { error: rErr } = await supabase.from("reviews").insert({
    job_id: job.id,
    cliente_id: user.id,
    professional_id: job.profissional_id,
    specialty,
    rating: input.rating,
    comment: input.comment || null,
  });
  if (rErr) return { ok: false as const, error: rErr.message };

  // marca o job como avaliado (a nota da skill é recalculada por trigger no banco)
  await supabase.from("jobs").update({ status: "avaliado" }).eq("id", job.id);
  revalidatePath(`/servico/${job.id}`);
  revalidatePath("/painel");
  return { ok: true as const };
}
