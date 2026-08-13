"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type FollowUpState = { ok: boolean; message: string };

async function autenticar() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function criarFollowUp(_: FollowUpState, formData: FormData): Promise<FollowUpState> {
  const { supabase, user } = await autenticar();
  if (!user) return { ok: false, message: "Sua sessão expirou." };
  const pedidoId = String(formData.get("pedidoId") ?? "");
  const data = String(formData.get("data") ?? "");
  const titulo = String(formData.get("titulo") ?? "Retornar contato").trim();
  const dueAt = new Date(data);
  if (!pedidoId || !data || Number.isNaN(dueAt.getTime())) return { ok: false, message: "Informe uma data válida." };
  const { error } = await supabase.rpc("criar_follow_up", { p_quote_request_id: pedidoId, p_due_at: dueAt.toISOString(), p_title: titulo });
  if (error) return { ok: false, message: error.code === "23505" ? "Já existe um follow-up pendente para esta oportunidade." : error.message };
  revalidatePath("/painel/oportunidades"); revalidatePath("/painel");
  return { ok: true, message: "Follow-up programado." };
}

export async function concluirFollowUp(_: FollowUpState, formData: FormData): Promise<FollowUpState> {
  const { supabase, user } = await autenticar();
  if (!user) return { ok: false, message: "Sua sessão expirou." };
  const taskId = String(formData.get("taskId") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  const notes = String(formData.get("notes") ?? "");
  const { error } = await supabase.rpc("concluir_follow_up", { p_task_id: taskId, p_outcome: outcome, p_notes: notes });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/painel/oportunidades"); revalidatePath("/painel");
  return { ok: true, message: "Follow-up concluído." };
}
