"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ehAdmin(supabase: Awaited<ReturnType<typeof createClient>>, uid: string) {
  const { data } = await supabase.from("profiles").select("role").eq("id", uid).single();
  return data?.role === "admin";
}

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
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };
  if (!(await ehAdmin(supabase, user.id))) return { ok: false as const, error: "Acesso restrito." };

  const aprovado = status === "verificado";
  const { error } = await supabase
    .from(tabela)
    .update({
      verification_status: status,
      verified_at: aprovado ? new Date().toISOString() : null,
      ...(tabela === "distributors" ? { ativo: aprovado } : {}),
    })
    .eq("id", id);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/admin");
  return { ok: true as const };
}

export async function aprovarProfissional(id: string) {
  return definirVerificacao("professionals", id, "verificado");
}
export async function rejeitarProfissional(id: string) {
  return definirVerificacao("professionals", id, "rejeitado");
}
export async function aprovarDistribuidora(id: string) {
  return definirVerificacao("distributors", id, "verificado");
}
export async function rejeitarDistribuidora(id: string) {
  return definirVerificacao("distributors", id, "rejeitado");
}
