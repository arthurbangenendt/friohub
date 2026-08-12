"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

export async function signup(formData: FormData) {
  const supabase = await createClient();

  const nome = String(formData.get("nome") ?? "");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "cliente");

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { nome, role } },
  });

  if (error) {
    redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  }

  // Se a confirmação de email estiver ligada, ainda não há sessão.
  if (!data.session) {
    redirect(`/login?aviso=${encodeURIComponent("Confirme seu email para entrar.")}`);
  }
  redirect("/painel");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
