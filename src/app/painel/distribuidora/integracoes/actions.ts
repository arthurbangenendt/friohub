"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/* Chaves de API pra sync de catálogo via ERP.
 *
 * A chave crua só existe na resposta de `criarChaveApi` — depois disso só o
 * `key_prefix` fica visível, nunca o hash. Ver 20260903110000_distributor_api_keys.sql.
 */

export async function criarChaveApi(nome: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const nomeAparado = nome.trim();
  if (nomeAparado.length < 2) return { ok: false as const, error: "Dê um nome pra identificar essa chave (ex.: \"ERP produção\")." };

  const { data, error } = await supabase.rpc("criar_chave_api_distribuidora", { p_nome: nomeAparado });
  if (error) return { ok: false as const, error: error.message };

  const linha = Array.isArray(data) ? data[0] : null;
  if (!linha?.chave) return { ok: false as const, error: "Não foi possível criar a chave." };

  revalidatePath("/painel/distribuidora/integracoes");
  return { ok: true as const, chave: linha.chave as string };
}

export async function revogarChaveApi(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { error } = await supabase.rpc("revogar_chave_api_distribuidora", { p_id: id });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/distribuidora/integracoes");
  return { ok: true as const };
}
