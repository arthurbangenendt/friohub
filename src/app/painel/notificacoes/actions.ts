"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type PreferenciasNotificacao = {
  email_enabled: boolean;
  quote_requests: boolean;
  quotes: boolean;
  job_updates: boolean;
  messages: boolean;
  reminders: boolean;
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
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/notificacoes");
  return { ok: true as const };
}
