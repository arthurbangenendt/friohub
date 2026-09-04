"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CATEGORIA_DIST_IDS } from "./categorias";

export async function registrarDespesaDistribuidora(input: { categoria: string; descricao: string; valor: number; data: string; purchaseOrderId: string | null }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  if (!CATEGORIA_DIST_IDS.includes(input.categoria)) return { ok: false as const, error: "Categoria inválida." };
  if (!Number.isFinite(input.valor) || !(input.valor > 0) || input.valor > 99_999_999.99) {
    return { ok: false as const, error: "Informe um valor maior que zero." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.data) || Number.isNaN(Date.parse(`${input.data}T12:00:00`))) {
    return { ok: false as const, error: "Informe uma data válida." };
  }
  if (input.descricao.trim().length > 180) {
    return { ok: false as const, error: "A descrição deve ter no máximo 180 caracteres." };
  }

  const purchaseOrderId = input.purchaseOrderId?.trim() || null;
  if (purchaseOrderId && !/^[0-9a-f-]{36}$/i.test(purchaseOrderId)) {
    return { ok: false as const, error: "Pedido inválido." };
  }
  if (purchaseOrderId) {
    /* A RLS já limita a leitura, e o filtro explícito permite ao Postgres usar
       o índice de distribuidora. Esta validação também impede que um UUID de
       pedido de outra distribuidora seja associado manualmente pela action. */
    const { data: pedido, error: pedidoError } = await supabase
      .from("purchase_orders")
      .select("id")
      .eq("id", purchaseOrderId)
      .eq("distributor_id", user.id)
      .maybeSingle();
    if (pedidoError) return { ok: false as const, error: "Não foi possível validar o pedido." };
    if (!pedido) return { ok: false as const, error: "Este pedido não pertence ao seu perfil." };
  }

  const { error } = await supabase.from("distributor_expenses").insert({
    distributor_id: user.id,
    purchase_order_id: purchaseOrderId,
    categoria: input.categoria,
    descricao: input.descricao.trim() || null,
    valor: input.valor,
    data: input.data,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/distribuidora/financeiro");
  return { ok: true as const };
}

export async function removerDespesaDistribuidora(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false as const, error: "Despesa inválida." };

  // O `eq` na dona é redundante com a RLS, mas deixa a intenção explícita.
  const { error } = await supabase.from("distributor_expenses").delete().eq("id", id).eq("distributor_id", user.id);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/distribuidora/financeiro");
  return { ok: true as const };
}
