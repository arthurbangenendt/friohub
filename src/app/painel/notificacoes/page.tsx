import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PreferenciasForm } from "./PreferenciasForm";
import { ListaNotificacoes } from "./ListaNotificacoes";
import type { PreferenciasNotificacao } from "./actions";
import { paraView, type NotificacaoBruta } from "@/lib/notificacoes";
import { Cabecalho, wrap } from "../shared";

/* Quem nunca abriu esta tela não tem linha em `notification_preferences`, e o
   banco trata ausência como tudo ligado. O padrão aqui espelha isso — se
   divergir, a tela mostra uma coisa e o `enqueue_notification` faz outra. */
const PADRAO: PreferenciasNotificacao = {
  email_enabled: true, quote_requests: true, quotes: true,
  job_updates: true, messages: true, reminders: true,
  inapp_enabled: true, inapp_quote_requests: true, inapp_quotes: true,
  inapp_job_updates: true, inapp_messages: true, inapp_reminders: true,
  whatsapp_enabled: true, whatsapp_quote_requests: true, whatsapp_quotes: true,
  whatsapp_job_updates: true, whatsapp_messages: true, whatsapp_reminders: true,
};

const PAGINA = 30;

export default async function NotificacoesPage({ searchParams }: PageProps<"/painel/notificacoes">) {
  const sp = await searchParams;
  /* O rótulo do menu diz "Notificações", então a aba padrão precisa ser o que a
     pessoa espera encontrar: os avisos. Antes esta rota abria direto nas
     preferências, que é configuração, não conteúdo. */
  const aba = sp.aba === "preferencias" ? "preferencias" : "avisos";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: prefs }, { data: linhas }] = await Promise.all([
    supabase
      .from("notification_preferences")
      .select("email_enabled, quote_requests, quotes, job_updates, messages, reminders, inapp_enabled, inapp_quote_requests, inapp_quotes, inapp_job_updates, inapp_messages, inapp_reminders, whatsapp_enabled, whatsapp_quote_requests, whatsapp_quotes, whatsapp_job_updates, whatsapp_messages, whatsapp_reminders")
      .eq("user_id", user.id)
      .maybeSingle(),
    /* Sem filtro por destinatário: a política de SELECT já recorta para o
       usuário logado e para o que tem `inapp_allowed`. */
    supabase
      .from("notification_outbox")
      .select("id, event_type, aggregate_type, aggregate_id, payload, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(PAGINA),
  ]);

  const notificacoes = ((linhas ?? []) as NotificacaoBruta[]).map(paraView);
  const naoLidas = notificacoes.filter((n) => !n.lida).length;

  return (
    <div style={wrap}>
      <Cabecalho eyebrow="Acompanhamento" titulo="Notificações" />

      <div style={{ display: "flex", gap: 6, margin: "22px 0 20px" }}>
        <Aba href="/painel/notificacoes" ativa={aba === "avisos"}>
          Avisos{naoLidas > 0 ? ` (${naoLidas})` : ""}
        </Aba>
        <Aba href="/painel/notificacoes?aba=preferencias" ativa={aba === "preferencias"}>
          Preferências
        </Aba>
      </div>

      {aba === "avisos" ? (
        <ListaNotificacoes itens={notificacoes} temNaoLidas={naoLidas > 0} />
      ) : (
        <PreferenciasForm inicial={(prefs as PreferenciasNotificacao | null) ?? PADRAO} />
      )}
    </div>
  );
}

function Aba({ href, ativa, children }: { href: string; ativa: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={ativa ? "page" : undefined}
      style={{
        fontSize: 13.5, fontWeight: 600, padding: "7px 14px", borderRadius: 100,
        border: "1px solid var(--line)",
        background: ativa ? "var(--cool)" : "var(--surface)",
        color: ativa ? "#fff" : "var(--ink-soft)",
      }}
    >
      {children}
    </Link>
  );
}
