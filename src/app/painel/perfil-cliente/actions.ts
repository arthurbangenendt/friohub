"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { apenasDigitos, validarTelefone } from "@/lib/documento";

export type ClienteInput = {
  nome: string;
  telefone: string;
};

export async function salvarPerfilCliente(input: ClienteInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const nome = input.nome.trim();
  if (nome.length < 3) return { ok: false as const, error: "Informe seu nome completo." };

  const telefone = apenasDigitos(input.telefone);
  if (telefone && !validarTelefone(telefone)) {
    return { ok: false as const, error: "Telefone inválido. Use DDD + número." };
  }

  const { error: pErr } = await supabase.from("profiles").update({ nome }).eq("id", user.id);
  if (pErr) return { ok: false as const, error: pErr.message };

  /* Telefone vive em `profile_private`, fora da tabela de exibição pública.
     Upsert porque a linha só nasce no cadastro quando havia dado sensível —
     quem se cadastrou antes disso pode não ter linha ainda. */
  const { error: tErr } = await supabase
    .from("profile_private")
    .upsert({ id: user.id, telefone: telefone || null }, { onConflict: "id" });
  if (tErr) return { ok: false as const, error: tErr.message };

  revalidatePath("/painel");
  revalidatePath("/painel/perfil-cliente");
  return { ok: true as const };
}
