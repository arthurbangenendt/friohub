"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/* Uma função de moderação serve as duas tabelas — mesmo padrão de
   `definirVerificacao` em admin/actions.ts, que serve professionals e
   distributors por um parâmetro em vez de duplicar a lógica. */
type Tabela = "reviews" | "client_reviews";

async function moderar(tabela: Tabela, id: string, ocultar: boolean, motivo: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const justificativa = motivo.trim();
  if (justificativa.length < 5) {
    return { ok: false as const, error: "Informe uma justificativa com pelo menos 5 caracteres." };
  }

  const { error } = await supabase.rpc("moderar_review", {
    p_tabela: tabela,
    p_id: id,
    p_ocultar: ocultar,
    p_motivo: justificativa,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/admin/avaliacoes");
  return { ok: true as const };
}

export async function ocultarReviewProfissional(id: string, motivo: string) {
  return moderar("reviews", id, true, motivo);
}
export async function restaurarReviewProfissional(id: string, motivo: string) {
  return moderar("reviews", id, false, motivo);
}
export async function ocultarReviewCliente(id: string, motivo: string) {
  return moderar("client_reviews", id, true, motivo);
}
export async function restaurarReviewCliente(id: string, motivo: string) {
  return moderar("client_reviews", id, false, motivo);
}
