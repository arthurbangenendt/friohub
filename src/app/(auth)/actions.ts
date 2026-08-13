"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { apenasDigitos, validarDocumento, validarTelefone } from "@/lib/documento";
import { TERMOS_VERSAO } from "./termos-versao";

const SENHA_MINIMA = 8;

export async function login(formData: FormData) {
  const supabase = await createClient();

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/painel");
}

/* Toda validação é refeita aqui. O formulário do cliente valida para dar
   feedback rápido, mas nada impede um POST direto no server action — se a
   checagem só existisse no browser, entraria CPF inválido e conta sem aceite
   dos termos na base. */
export async function signup(formData: FormData) {
  const supabase = await createClient();

  const nome = String(formData.get("nome") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmar = String(formData.get("confirmar") ?? "");
  const telefone = String(formData.get("telefone") ?? "");
  const documento = String(formData.get("documento") ?? "");
  const aceite = formData.get("aceite");
  /* Papéis que o cadastro público pode criar. 'admin' nunca sai daqui — o
     allowlist é repetido em `handle_new_user`, que é a barreira real. */
  const PAPEIS_PUBLICOS = ["cliente", "profissional", "distribuidora"] as const;
  const bruto = String(formData.get("role") ?? "cliente");
  const role = (PAPEIS_PUBLICOS as readonly string[]).includes(bruto) ? bruto : "cliente";

  // Cada papel cai no lugar onde ainda falta trabalho para ele ser encontrável.
  const destino =
    role === "profissional" ? "/painel/perfil"
    : role === "distribuidora" ? "/painel/distribuidora/perfil"
    : "/painel";

  const falhar = (msg: string) =>
    redirect(`/signup?error=${encodeURIComponent(msg)}${role !== "cliente" ? `&role=${role}` : ""}`);

  if (nome.length < 3) falhar("Informe seu nome completo.");
  if (password.length < SENHA_MINIMA) falhar(`A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`);
  if (password !== confirmar) falhar("As senhas não conferem.");
  if (!validarTelefone(telefone)) falhar("Telefone inválido. Use DDD + número.");
  if (!validarDocumento(documento)) falhar("CPF ou CNPJ inválido.");
  if (!aceite) falhar("É preciso aceitar os Termos de Uso e a Política de Privacidade.");

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        nome,
        role,
        telefone: apenasDigitos(telefone),
        cpf_cnpj: apenasDigitos(documento),
        termos_versao: TERMOS_VERSAO,
      },
    },
  });

  if (error) {
    redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  }

  // Se a confirmação de email estiver ligada, ainda não há sessão.
  if (!data.session) {
    redirect(`/login?aviso=${encodeURIComponent("Confirme seu email para entrar.")}`);
  }
  redirect(destino);
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
