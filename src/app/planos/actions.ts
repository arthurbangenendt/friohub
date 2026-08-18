"use server";

import { createClient } from "@/lib/supabase/server";

/* Cobrança de verdade — aciona a Edge Function `asaas-assinar`.
 *
 * Só chega até aqui quando `city_billing_config.cobranca_ativa` está ligado
 * (hoje só em São Paulo, para o teste de sandbox). A trava de negócio de
 * verdade vive no banco (`preparar_assinatura_plano`, 20260818144000) — este
 * server action é só o transporte do JWT até a função, nunca a decisão. */
export type ResultadoAssinatura =
  | { ok: true; checkoutUrl: string }
  | { ok: false; erro: string };

export async function iniciarAssinatura(
  slug: string,
  ciclo: Ciclo,
  cpfCnpj: string,
): Promise<ResultadoAssinatura> {
  const supabase = await createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return { ok: false, erro: "Sua sessão expirou. Entre novamente." };
  }

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/asaas-assinar`;
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ plano_slug: slug, ciclo, cpf_cnpj: cpfCnpj }),
    });
  } catch {
    return { ok: false, erro: "Não foi possível falar com o gateway de pagamento agora." };
  }

  const corpo = (await resposta.json().catch(() => ({}))) as {
    ok?: boolean;
    checkout_url?: string;
    error?: string;
  };

  if (!resposta.ok || !corpo.ok || !corpo.checkout_url) {
    return { ok: false, erro: corpo.error ?? "Não foi possível iniciar a assinatura." };
  }

  return { ok: true, checkoutUrl: corpo.checkout_url };
}

/* Upgrade/downgrade — aciona `asaas-trocar-plano`.
 *
 * Só chega até aqui quando o profissional JÁ tem assinatura active/overdue
 * (ver `planoAtualSlug` em page.tsx) — para a primeira assinatura, o botão
 * continua usando `iniciarAssinatura`. O backend decide sozinho se o plano
 * pedido é upgrade (cobra a diferença agora) ou downgrade (agenda, sem
 * cobrança) — este action só carrega a sessão até lá. */
export type ResultadoTroca =
  | { ok: true; tipo: "upgrade"; checkoutUrl: string }
  | { ok: true; tipo: "downgrade"; aviso: string }
  | { ok: false; erro: string };

export async function trocarPlano(slug: string): Promise<ResultadoTroca> {
  const supabase = await createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return { ok: false, erro: "Sua sessão expirou. Entre novamente." };
  }

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/asaas-trocar-plano`;
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ plano_slug: slug }),
    });
  } catch {
    return { ok: false, erro: "Não foi possível falar com o gateway de pagamento agora." };
  }

  const corpo = (await resposta.json().catch(() => ({}))) as {
    ok?: boolean;
    tipo?: "upgrade" | "downgrade";
    checkout_url?: string;
    aviso?: string;
    error?: string;
  };

  if (!resposta.ok || !corpo.ok) {
    return { ok: false, erro: corpo.error ?? "Não foi possível trocar de plano." };
  }
  if (corpo.tipo === "upgrade" && corpo.checkout_url) {
    return { ok: true, tipo: "upgrade", checkoutUrl: corpo.checkout_url };
  }
  return { ok: true, tipo: "downgrade", aviso: corpo.aviso ?? "Downgrade agendado." };
}

/* Assinatura de planos — registro de intenção.
 *
 * [RISCO 1] Não existe gateway de pagamento no sistema. `city_billing_config`
 * mantém a cobrança desligada na cidade piloto de propósito (entrada grátis no
 * cold start). Enquanto isso, o botão de assinar registra QUEM quer QUAL plano
 * — que é o dado necessário para decidir se vale construir a cobrança — e não
 * finge que houve pagamento. Ver 20260813190000_planos_assinatura.sql. */

export type Ciclo = "mensal" | "anual";

export type ResultadoInteresse =
  | { ok: true }
  | { ok: false; erro: string; precisaLogin?: boolean };

export async function registrarInteresse(
  slug: string,
  ciclo: Ciclo,
): Promise<ResultadoInteresse> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, erro: "Entre na sua conta para escolher um plano.", precisaLogin: true };
  }

  const { error } = await supabase.rpc("registrar_interesse_plano", {
    p_slug: slug,
    p_ciclo: ciclo,
  });

  if (error) {
    // As mensagens do RPC já são escritas para o usuário final ("Apenas perfis
    // de profissional podem assinar um plano."), então repassamos direto.
    return { ok: false, erro: error.message };
  }

  return { ok: true };
}
