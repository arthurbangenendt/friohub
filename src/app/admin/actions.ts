"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/* Uma função para as duas tabelas que têm verificação. `professionals` e
   `distributors` têm exatamente o mesmo trio de colunas de confiança, então
   duplicar a lógica só criaria duas versões para divergirem depois.

   A distribuidora ganha `ativo` junto com a aprovação: verificada mas inativa é
   um estado que só existe para suspensão manual — aprovar e deixar invisível
   seria aprovar pela metade. */
type TabelaVerificavel = "professionals" | "distributors";

async function definirVerificacao(
  tabela: TabelaVerificavel,
  id: string,
  status: "verificado" | "rejeitado",
  motivo: string,
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const justificativa = motivo.trim();
  if (justificativa.length < 5) {
    return { ok: false as const, error: "Informe uma justificativa com pelo menos 5 caracteres." };
  }

  const { error } = await supabase.rpc("definir_verificacao", {
    p_entity_type: tabela === "professionals" ? "professional" : "distributor",
    p_entity_id: id,
    p_status: status,
    p_reason: justificativa,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/admin");
  return { ok: true as const };
}

export async function aprovarProfissional(id: string, motivo: string) {
  return definirVerificacao("professionals", id, "verificado", motivo);
}
export async function rejeitarProfissional(id: string, motivo: string) {
  return definirVerificacao("professionals", id, "rejeitado", motivo);
}
export async function aprovarDistribuidora(id: string, motivo: string) {
  return definirVerificacao("distributors", id, "verificado", motivo);
}
export async function rejeitarDistribuidora(id: string, motivo: string) {
  return definirVerificacao("distributors", id, "rejeitado", motivo);
}

/* Lead de distribuidora interessada (formulário público em /distribuidoras) —
   não tem verificação, só um marcador de "já falei com essa pessoa". Usado
   direto como `action` de um <form> (sem JS de cliente), por isso devolve
   `void` — o padrão de retorno {ok,error} não bate com a assinatura exigida
   por essa forma de uso; se falhar, o admin só clica de novo. */
export async function marcarInteresseContatado(id: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("distributor_interest").update({ contatado_em: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin");
}
