"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function alterarPapel(userId: string, novoPapel: "admin" | "cliente", motivo: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const justificativa = motivo.trim();
  if (justificativa.length < 5) {
    return { ok: false as const, error: "Informe uma justificativa com pelo menos 5 caracteres." };
  }

  const { error } = await supabase.rpc("alterar_papel_usuario", {
    p_user_id: userId,
    p_new_role: novoPapel,
    p_reason: justificativa,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/admin/usuarios");
  return { ok: true as const };
}

/* Suspender/reativar precisa de service_role (auth.admin.updateUserById), então
 * passa pela edge function com o Bearer da sessão — mesmo padrão de
 * `aprovarDisputa` em admin/disputas/actions.ts, não best-effort. */
async function suspensao(userId: string, acao: "suspender" | "reativar", motivo: string) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false as const, error: "Não autenticado." };

  const justificativa = motivo.trim();
  if (justificativa.length < 5) {
    return { ok: false as const, error: "Informe uma justificativa com pelo menos 5 caracteres." };
  }

  let corpo: { ok?: boolean; error?: string };
  try {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/admin-suspender-usuario`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, acao, motivo: justificativa }),
    });
    corpo = await res.json();
    if (!res.ok) return { ok: false as const, error: corpo.error ?? "Não foi possível processar." };
  } catch {
    return { ok: false as const, error: "Não foi possível falar com o servidor agora." };
  }

  revalidatePath("/admin/usuarios");
  return { ok: true as const };
}

export async function suspenderUsuario(userId: string, motivo: string) {
  return suspensao(userId, "suspender", motivo);
}
export async function reativarUsuario(userId: string, motivo: string) {
  return suspensao(userId, "reativar", motivo);
}
