"use server";

import { createClient } from "@/lib/supabase/server";
import { apenasDigitos, validarTelefone } from "@/lib/documento";

export type InteresseInput = {
  nome: string;
  empresa: string;
  telefone: string;
  email: string;
  cidade: string;
  mensagem: string;
};

/* Formulário público de "fale com a gente" — sem login. O cadastro de
 * verdade (`/signup?role=distribuidora`) fica pro admin decidir enviar
 * depois de olhar o lead em `/admin`. */
export async function registrarInteresseDistribuidora(input: InteresseInput) {
  const nome = input.nome.trim();
  const empresa = input.empresa.trim();
  const telefone = apenasDigitos(input.telefone);
  const email = input.email.trim();
  const cidade = input.cidade.trim();

  if (nome.length < 2) return { ok: false as const, error: "Informe seu nome." };
  if (empresa.length < 2) return { ok: false as const, error: "Informe o nome da distribuidora." };
  if (!telefone && !email) return { ok: false as const, error: "Informe telefone ou e-mail para contato." };
  if (telefone && !validarTelefone(telefone)) return { ok: false as const, error: "Telefone inválido. Use DDD + número." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false as const, error: "E-mail inválido." };

  const supabase = await createClient();
  const { error } = await supabase.from("distributor_interest").insert({
    nome,
    empresa,
    telefone: telefone || null,
    email: email || null,
    cidade: cidade || null,
    mensagem: input.mensagem.trim() || null,
  });
  if (error) return { ok: false as const, error: "Não foi possível enviar agora. Tente de novo em instantes." };

  return { ok: true as const };
}
