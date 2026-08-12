"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CATEGORIA_IDS } from "./categorias";


export async function registrarDespesa(input: { categoria: string; descricao: string; valor: number; data: string }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  if (!CATEGORIA_IDS.includes(input.categoria)) return { ok: false as const, error: "Categoria inválida." };
  if (!(input.valor > 0)) return { ok: false as const, error: "Informe um valor maior que zero." };

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

  // O `eq` no dono é redundante com a RLS, mas deixa a intenção explícita.
  const { error } = await supabase.from("expenses").delete().eq("id", id).eq("professional_id", user.id);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/financeiro");
  return { ok: true as const };
}
