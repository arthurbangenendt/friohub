import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

/* Cliente com `service_role`.
 *
 * É ele que alcança as funções `security definer` que o schema reserva ao
 * worker (`espelhar_mensagem_chatwoot`, `reservar_notificacoes_whatsapp`,
 * `pii_liberado_para_chatwoot`). Nenhuma dessas é executável por `authenticated`
 * — o contrato está nas migrations 20260815090000 a 20260815093000.
 */
export function servico(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias.");

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
