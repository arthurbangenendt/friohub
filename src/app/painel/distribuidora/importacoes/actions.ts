"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ItemPlanilha } from "@/lib/csv-importacao";

/* Confirmação do lote de importação em massa.
 *
 * `aplicar_lote_importacao` é a única função que escreve em `products` a
 * partir de um lote — nada entra no catálogo sem essa chamada explícita.
 * Ver 20260903140000_product_import_aplicar.sql.
 */

/** Upload manual de planilha — cobre a distribuidora sem ERP/API. Chama a
 *  MESMA RPC do caminho de API (`ingerir_lote_produtos`), só que numa sessão
 *  autenticada em vez de service_role — ver 20260903150000. O lote entra no
 *  mesmo staging/validação/preview de sempre. */
export async function importarPlanilha(itens: ItemPlanilha[]) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  if (itens.length === 0) {
    return { ok: false as const, error: "A planilha não tem nenhuma linha válida pra importar." };
  }
  if (itens.length > 2000) {
    return { ok: false as const, error: "Máximo de 2000 itens por importação — divida em mais de um arquivo." };
  }

  const { data: batchId, error } = await supabase.rpc("ingerir_lote_produtos", {
    p_distributor_id: user.id,
    p_idempotency_key: `manual:${crypto.randomUUID()}`,
    p_itens: itens,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/distribuidora/importacoes");
  return { ok: true as const, batchId: batchId as string };
}

export async function aplicarLoteImportacao(batchId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { data, error } = await supabase.rpc("aplicar_lote_importacao", { p_batch_id: batchId });
  if (error) return { ok: false as const, error: error.message };

  const linha = Array.isArray(data) ? data[0] : null;

  revalidatePath("/painel/distribuidora/importacoes");
  revalidatePath(`/painel/distribuidora/importacoes/${batchId}`);
  revalidatePath("/painel/distribuidora/catalogo");
  return { ok: true as const, aplicados: linha?.aplicados ?? 0, ignorados: linha?.ignorados ?? 0 };
}

export async function rejeitarLoteImportacao(batchId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { error } = await supabase.rpc("rejeitar_lote_importacao", { p_batch_id: batchId });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/distribuidora/importacoes");
  revalidatePath(`/painel/distribuidora/importacoes/${batchId}`);
  return { ok: true as const };
}
