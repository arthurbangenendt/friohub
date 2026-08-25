"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/* Rejeitar não envolve gateway nenhum — RPC direta, mesmo padrão de
 * `definirVerificacao` em admin/actions.ts (eh_admin() via auth.uid()). */
export async function rejeitarDisputa(disputeId: string, notaAdmin: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const justificativa = notaAdmin.trim();
  if (justificativa.length < 5) {
    return { ok: false as const, error: "Informe uma justificativa com pelo menos 5 caracteres." };
  }

  const { error } = await supabase.rpc("resolver_disputa_rejeitar", {
    p_dispute_id: disputeId,
    p_nota_admin: justificativa,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/admin/disputas");
  return { ok: true as const };
}

/* Aprovar dispara o estorno de verdade no Asaas — não é best-effort como
 * `aceitarProposta` chamando `asaas-cobrar-servico`: se a edge function
 * falhar, o admin precisa saber e decidir de novo, não seguir em frente
 * achando que reembolsou. Mesmo padrão de invocação de `tentarNovamenteCobranca`
 * (fetch direto com o Bearer da sessão, não best-effort). */
export async function aprovarDisputa(disputeId: string, valorReembolso: number, notaAdmin: string) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false as const, error: "Não autenticado." };

  const justificativa = notaAdmin.trim();
  if (justificativa.length < 5) {
    return { ok: false as const, error: "Informe uma justificativa com pelo menos 5 caracteres." };
  }
  if (!Number.isFinite(valorReembolso) || valorReembolso <= 0) {
    return { ok: false as const, error: "Informe um valor de reembolso válido." };
  }

  let corpo: { ok?: boolean; error?: string };
  try {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/asaas-resolver-disputa`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ dispute_id: disputeId, valor_reembolso: valorReembolso, nota_admin: justificativa }),
    });
    corpo = await res.json();
    if (!res.ok) return { ok: false as const, error: corpo.error ?? "Não foi possível processar o reembolso." };
  } catch {
    return { ok: false as const, error: "Não foi possível falar com o gateway de pagamento agora." };
  }

  revalidatePath("/admin/disputas");
  return { ok: true as const };
}
