import type { createClient } from "@/lib/supabase/server";

/* Grava o CPF/CNPJ do cliente em `profile_private`, só se ainda não houver
 * documento salvo — nunca sobrescreve o que já existe (editar depois de
 * vinculado ao gateway Asaas mudaria a identidade do pagador).
 *
 * Duas etapas porque conta anterior a 12/08 (antes do documento virar
 * obrigatório no cadastro) não tem NENHUMA linha em `profile_private` — um
 * `update` sozinho não cria linha, então "funciona" sem erro e não salva
 * nada (bug real, reproduzido em produção 24/08). `upsert` com
 * `ignoreDuplicates` cria a linha só se faltar (não mexe em quem já tem
 * linha, com ou sem documento); o `update` depois cobre quem já tinha linha
 * mas ainda sem documento.
 *
 * Usado tanto no aceite de proposta (coleta just-in-time) quanto no perfil
 * do cliente — mantido num só lugar para o fix não se perder se um dos dois
 * pontos de chamada for editado sem o outro.
 */
export async function salvarCpfCnpjSeAusente(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  cpfCnpjDigitos: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: erroCriarLinha } = await supabase
    .from("profile_private")
    .upsert({ id: userId, cpf_cnpj: cpfCnpjDigitos }, { onConflict: "id", ignoreDuplicates: true });
  if (erroCriarLinha) return { ok: false, error: "Não foi possível salvar o CPF/CNPJ." };

  const { error: erroDocumento } = await supabase
    .from("profile_private")
    .update({ cpf_cnpj: cpfCnpjDigitos })
    .eq("id", userId)
    .is("cpf_cnpj", null);
  if (erroDocumento) return { ok: false, error: "Não foi possível salvar o CPF/CNPJ." };

  return { ok: true };
}
