"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { apenasDigitos, validarDocumento, validarTelefone } from "@/lib/documento";
import { salvarCpfCnpjSeAusente } from "@/lib/supabase/salvar-cpf-cnpj-cliente";

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

export async function salvarCpfCnpjCliente(cpfCnpj: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  if (!validarDocumento(cpfCnpj)) {
    return { ok: false as const, error: "Informe um CPF ou CNPJ válido." };
  }

  const r = await salvarCpfCnpjSeAusente(supabase, user.id, cpfCnpj.replace(/\D/g, ""));
  if (!r.ok) return { ok: false as const, error: r.error };

  revalidatePath("/painel/perfil-cliente");
  return { ok: true as const };
}

export type EnderecoInput = {
  cep: string;
  bairro: string;
  enderecoCompleto: string;
};

/* Diferente do CPF/CNPJ, endereço muda de verdade ao longo do tempo — upsert
   livre, sem a trava de "só grava se ainda não tiver" (mesmo raciocínio do
   telefone em salvarPerfilCliente). Só pré-preenche /solicitar e o aceite de
   proposta; o cliente sempre pode editar o endereço na hora de cada pedido. */
export async function salvarEnderecoCliente(input: EnderecoInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const cep = apenasDigitos(input.cep);
  if (cep && cep.length !== 8) return { ok: false as const, error: "CEP inválido." };

  const { error } = await supabase.from("profile_private").upsert({
    id: user.id,
    endereco_cep: cep || null,
    endereco_bairro: input.bairro.trim() || null,
    endereco_completo: input.enderecoCompleto.trim() || null,
  }, { onConflict: "id" });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/perfil-cliente");
  return { ok: true as const };
}
