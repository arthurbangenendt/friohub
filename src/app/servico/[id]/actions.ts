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

export async function proporAgendamento(input: {
  jobId: string;
  inicio: string;
  fim: string;
  observacoes: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const inicio = new Date(input.inicio);
  const fim = new Date(input.fim);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
    return { ok: false as const, error: "Informe data e horário válidos." };
  }

  const { error } = await supabase.rpc("propor_agendamento", {
    p_job_id: input.jobId,
    p_starts_at: inicio.toISOString(),
    p_ends_at: fim.toISOString(),
    p_notes: input.observacoes,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath(`/servico/${input.jobId}`);
  return { ok: true as const };
}

export async function responderAgendamento(input: {
  jobId: string;
  appointmentId: string;
  aceitar: boolean;
  motivo?: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("responder_agendamento", {
    p_appointment_id: input.appointmentId,
    p_accept: input.aceitar,
    p_reason: input.motivo ?? "",
  });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath(`/servico/${input.jobId}`);
  return { ok: true as const };
}

export async function cancelarAgendamento(input: {
  jobId: string;
  appointmentId: string;
  motivo: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancelar_agendamento", {
    p_appointment_id: input.appointmentId,
    p_reason: input.motivo,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath(`/servico/${input.jobId}`);
  return { ok: true as const };
}

export async function avaliarJob(input: { jobId: string; rating: number; comment: string }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { ok: false as const, error: "Selecione uma nota de 1 a 5." };
  }

  const comment = input.comment.trim();
  if (comment.length > 2000) {
    return { ok: false as const, error: "O comentário deve ter no máximo 2.000 caracteres." };
  }

  const { data: job } = await supabase
    .from("jobs")
    .select("id, job_type, profissional_id, cliente_id, status")
    .eq("id", input.jobId)
    .single();

  if (!job) return { ok: false as const, error: "Serviço não encontrado." };
  if (job.cliente_id !== user.id) return { ok: false as const, error: "Apenas o cliente pode avaliar." };
  if (!job.profissional_id) return { ok: false as const, error: "Serviço sem profissional." };

  // A avaliação é imutável e única por serviço. Tratar uma repetição como
  // sucesso torna a ação idempotente: se a primeira resposta se perder ou a
  // tela ainda não tiver atualizado, o cliente não recebe um erro técnico.
  const { data: reviewExistente, error: reviewLookupErr } = await supabase
    .from("reviews")
    .select("id")
    .eq("job_id", job.id)
    .maybeSingle();
  if (reviewLookupErr) return { ok: false as const, error: reviewLookupErr.message };
  if (reviewExistente) {
    revalidatePath(`/servico/${job.id}`);
    return { ok: true as const, alreadyExisted: true as const };
  }

  if (!["concluido", "avaliado"].includes(job.status)) {
    return { ok: false as const, error: "O serviço ainda não foi concluído." };
  }

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
    comment: comment || null,
  });
  if (rErr) {
    // Protege também contra dois envios simultâneos entre o SELECT acima e o
    // INSERT. `reviews_job_id_key` é a regra legítima de uma avaliação por job.
    if (rErr.code === "23505" && rErr.message.includes("reviews_job_id_key")) {
      revalidatePath(`/servico/${job.id}`);
      return { ok: true as const, alreadyExisted: true as const };
    }
    return { ok: false as const, error: rErr.message };
  }

  /* O job vira 'avaliado' por trigger no banco (`marca_job_avaliado`), junto com o
     recálculo da nota da skill. Era um update daqui, feito como cliente — a trava
     de transição de 20260812220000 passou a preservar esse status em silêncio, e
     a regra vive melhor onde ela de fato é: como consequência da review existir. */
  revalidatePath(`/servico/${job.id}`);
  revalidatePath("/painel");
  revalidatePath(`/profissional/${job.profissional_id}`);
  revalidatePath("/profissionais");
  revalidatePath("/painel/avaliacoes");
  return { ok: true as const, alreadyExisted: false as const };
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
