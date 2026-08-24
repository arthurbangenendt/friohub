"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/* As colunas sem prefixo são as antigas e continuam significando E-MAIL — não
   foram reinterpretadas, para que uma escolha feita antes da separação de
   canais não passe a valer para um canal que a pessoa nunca configurou. */
export type PreferenciasNotificacao = {
  email_enabled: boolean;
  quote_requests: boolean;
  quotes: boolean;
  job_updates: boolean;
  messages: boolean;
  reminders: boolean;
  inapp_enabled: boolean;
  inapp_quote_requests: boolean;
  inapp_quotes: boolean;
  inapp_job_updates: boolean;
  inapp_messages: boolean;
  inapp_reminders: boolean;
  whatsapp_enabled: boolean;
  whatsapp_quote_requests: boolean;
  whatsapp_quotes: boolean;
  whatsapp_job_updates: boolean;
  whatsapp_messages: boolean;
  whatsapp_reminders: boolean;
};

export async function salvarPreferencias(input: PreferenciasNotificacao) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { error } = await supabase.from("notification_preferences").upsert({
    user_id: user.id,
    email_enabled: input.email_enabled,
    quote_requests: input.quote_requests,
    quotes: input.quotes,
    job_updates: input.job_updates,
    messages: input.messages,
    reminders: input.reminders,
    inapp_enabled: input.inapp_enabled,
    inapp_quote_requests: input.inapp_quote_requests,
    inapp_quotes: input.inapp_quotes,
    inapp_job_updates: input.inapp_job_updates,
    inapp_messages: input.inapp_messages,
    inapp_reminders: input.inapp_reminders,
    whatsapp_enabled: input.whatsapp_enabled,
    whatsapp_quote_requests: input.whatsapp_quote_requests,
    whatsapp_quotes: input.whatsapp_quotes,
    whatsapp_job_updates: input.whatsapp_job_updates,
    whatsapp_messages: input.whatsapp_messages,
    whatsapp_reminders: input.whatsapp_reminders,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/notificacoes");
  return { ok: true as const };
}

/* A leitura é UPDATE numa tabela que não aceita escrita direta pela Data API —
   por isso passa por RPC `security definer`, que confere o destinatário. */
export async function marcarLida(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("marcar_notificacao_lida", { p_id: id });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/notificacoes");
  revalidatePath("/painel", "layout");
  return { ok: true as const };
}

export async function marcarTodasLidas() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("marcar_notificacoes_lidas");
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/notificacoes");
  revalidatePath("/painel", "layout");
  return { ok: true as const };
}
