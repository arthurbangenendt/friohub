"use server";

import { createClient } from "@/lib/supabase/server";

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
