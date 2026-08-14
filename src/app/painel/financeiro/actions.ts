"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CATEGORIA_IDS } from "./categorias";


export async function registrarDespesa(input: { categoria: string; descricao: string; valor: number; data: string }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  if (!CATEGORIA_IDS.includes(input.categoria)) return { ok: false as const, error: "Categoria inválida." };
  if (!Number.isFinite(input.valor) || !(input.valor > 0) || input.valor > 99_999_999.99) {
    return { ok: false as const, error: "Informe um valor maior que zero." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.data) || Number.isNaN(Date.parse(`${input.data}T12:00:00`))) {
    return { ok: false as const, error: "Informe uma data válida." };
  }
  if (input.descricao.trim().length > 180) {
    return { ok: false as const, error: "A descrição deve ter no máximo 180 caracteres." };
  }

  const { error } = await supabase.from("expenses").insert({
    professional_id: user.id,
    categoria: input.categoria,
    descricao: input.descricao.trim() || null,
    valor: input.valor,
    data: input.data,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/financeiro");
  return { ok: true as const };
}

export async function removerDespesa(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false as const, error: "Despesa inválida." };

  // O `eq` no dono é redundante com a RLS, mas deixa a intenção explícita.
  const { error } = await supabase.from("expenses").delete().eq("id", id).eq("professional_id", user.id);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/financeiro");
  return { ok: true as const };
}
