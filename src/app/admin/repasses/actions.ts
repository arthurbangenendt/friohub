"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/* Intervenção em payment_transfers — dinheiro real via Asaas. Uma função só
   pra duas ações (mesmo padrão de definirVerificacao), o guarda-corpo de
   estado mora na RPC (20260826092000_admin_intervir_repasse), não aqui. */
async function intervir(transferId: string, acao: "reenviar" | "cancelar", motivo: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const justificativa = motivo.trim();
  if (justificativa.length < 5) {
    return { ok: false as const, error: "Informe uma justificativa com pelo menos 5 caracteres." };
  }

  const { error } = await supabase.rpc("admin_intervir_repasse", {
    p_transfer_id: transferId,
    p_acao: acao,
    p_motivo: justificativa,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/admin/repasses");
  return { ok: true as const };
}

export async function reenviarTransferencia(id: string, motivo: string) {
  return intervir(id, "reenviar", motivo);
}
export async function cancelarTransferencia(id: string, motivo: string) {
  return intervir(id, "cancelar", motivo);
}
