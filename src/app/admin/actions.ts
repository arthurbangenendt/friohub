"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ehAdmin(supabase: Awaited<ReturnType<typeof createClient>>, uid: string) {
  const { data } = await supabase.from("profiles").select("role").eq("id", uid).single();
  return data?.role === "admin";
}

async function definirVerificacao(professionalId: string, status: "verificado" | "rejeitado") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };
  if (!(await ehAdmin(supabase, user.id))) return { ok: false as const, error: "Acesso restrito." };

  const { error } = await supabase
    .from("professionals")
    .update({ verification_status: status, verified_at: status === "verificado" ? new Date().toISOString() : null })
    .eq("id", professionalId);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/admin");
  return { ok: true as const };
}

export async function aprovarProfissional(id: string) {
  return definirVerificacao(id, "verificado");
}
export async function rejeitarProfissional(id: string) {
  return definirVerificacao(id, "rejeitado");
}
