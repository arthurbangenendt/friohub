"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { TAG_IDS } from "./tags-cliente";

import { SPECIALTY_OF } from "../../solicitar/tipos";
import type { JobType } from "../../solicitar/tipos";

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

  /* Sem especialidade correspondente (job "outros"), não há em que skill creditar
     a nota. O fallback anterior mandava tudo para "instalacao", inflando a
     reputação de uma especialidade que o profissional pode nem ter exercido. */
  const specialty = SPECIALTY_OF[job.job_type as JobType] ?? null;
  if (!specialty) {
    return { ok: false as const, error: "Este tipo de serviço ainda não pode ser avaliado por especialidade." };
  }
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

// ---------------------------------------------------------------------------
// Reputação do CLIENTE, escrita pelo profissional.
// Vocabulário fechado: o mesmo conjunto está no CHECK da tabela, então valor
// fora da lista é barrado no banco mesmo que passe daqui.
// ---------------------------------------------------------------------------

export async function avaliarCliente(input: { jobId: string; rating: number; tags: string[] }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  if (!(input.rating >= 1 && input.rating <= 5)) {
    return { ok: false as const, error: "Selecione uma nota de 1 a 5." };
  }
  const tags = [...new Set(input.tags)].filter((t) => TAG_IDS.includes(t));

  const { data: job } = await supabase
    .from("jobs")
    .select("id, cliente_id, profissional_id, status")
    .eq("id", input.jobId)
    .single();

  if (!job || job.profissional_id !== user.id) {
    return { ok: false as const, error: "Serviço não encontrado." };
  }
  if (!["concluido", "avaliado"].includes(job.status)) {
    return { ok: false as const, error: "Só é possível avaliar depois de concluir o serviço." };
  }

  const { error } = await supabase.from("client_reviews").insert({
    job_id: job.id,
    professional_id: user.id,
    cliente_id: job.cliente_id,
    rating: input.rating,
    tags,
  });
  if (error) {
    // unique(job_id): segunda avaliação do mesmo serviço
    if (error.code === "23505") return { ok: false as const, error: "Você já avaliou este cliente." };
    return { ok: false as const, error: error.message };
  }

  revalidatePath(`/servico/${job.id}`);
  return { ok: true as const };
}
