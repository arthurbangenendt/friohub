import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PreferenciasForm } from "./PreferenciasForm";
import type { PreferenciasNotificacao } from "./actions";

const PADRAO: PreferenciasNotificacao = {
  email_enabled: true,
  quote_requests: true,
  quotes: true,
  job_updates: true,
  messages: true,
  reminders: true,
};

export default async function NotificacoesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("notification_preferences")
    .select("email_enabled, quote_requests, quotes, job_updates, messages, reminders")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: "0 0 6px" }}>Notificações</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 26 }}>
        Escolha quais eventos importantes do marketplace chegam por e-mail.
      </p>
      <PreferenciasForm inicial={(data as PreferenciasNotificacao | null) ?? PADRAO} />
    </main>
  );
}
