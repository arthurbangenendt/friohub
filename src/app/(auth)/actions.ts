"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { apenasDigitos, validarDocumento, validarTelefone } from "@/lib/documento";
import { TERMOS_VERSAO } from "./termos-versao";
import { destinoSeguro } from "@/lib/proximo";

const SENHA_MINIMA = 8;

export async function login(formData: FormData) {
  const supabase = await createClient();

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  /* Sempre passa por `destinoSeguro`: o campo vem de um hidden no formulário,
     que qualquer um consegue editar. Ver a nota sobre open redirect em
     `@/lib/proximo`. */
  const destino = destinoSeguro(formData.get("next"));

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Preserva o destino no reenvio: errar a senha não pode custar o contexto.
    const p = new URLSearchParams({ error: error.message });
    if (destino !== "/painel") p.set("next", destino);
    redirect(`/login?${p.toString()}`);
  }
  redirect(destino);
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

  /* Cada papel cai no lugar onde ainda falta trabalho para ele ser encontrável.
     Só o cliente respeita o `next`: profissional e distribuidora precisam
     completar o cadastro antes de qualquer outra coisa, senão entram no
     marketplace invisíveis. */
  const proximo = destinoSeguro(formData.get("next"), "");
  const destino =
    role === "profissional" ? "/painel/perfil"
    : role === "distribuidora" ? "/painel/distribuidora/perfil"
    : proximo || "/painel";

  // Erro de validação não pode custar nem o papel escolhido nem o destino.
  const falhar = (msg: string) => {
    const p = new URLSearchParams({ error: msg });
    if (role !== "cliente") p.set("role", role);
    if (proximo) p.set("next", proximo);
    redirect(`/signup?${p.toString()}`);
  };

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
