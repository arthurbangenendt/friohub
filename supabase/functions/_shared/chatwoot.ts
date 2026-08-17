/* Cliente da API do Chatwoot.
 *
 * Três APIs, três autenticações — misturar dá 401 confuso:
 *   · Application  /api/v1/accounts/{id}/...  token de agente
 *   · Platform     /platform/api/v1/...       token de PlatformApp
 *   · Client       /public/api/v1/...         identificador da inbox (não usamos)
 *
 * Nada aqui roda no browser: o token de agente é administrador da conta.
 */

export const BASE_URL = (Deno.env.get("CHATWOOT_BASE_URL") ?? "").replace(/\/+$/, "");
export const ACCOUNT_ID = Deno.env.get("CHATWOOT_ACCOUNT_ID") ?? "";
const API_TOKEN = Deno.env.get("CHATWOOT_API_TOKEN") ?? "";
const PLATFORM_TOKEN = Deno.env.get("CHATWOOT_PLATFORM_TOKEN") ?? "";

export const MARKETPLACE_INBOX_ID = Number(Deno.env.get("CHATWOOT_MARKETPLACE_INBOX_ID") ?? "0");

export class ChatwootError extends Error {
  constructor(readonly status: number, readonly corpo: string, mensagem: string) {
    super(mensagem);
    this.name = "ChatwootError";
  }
}

async function requisitar(url: string, token: string, method: string, body?: unknown) {
  if (!BASE_URL) throw new Error("CHATWOOT_BASE_URL não configurada.");
  if (!token) throw new Error("Token do Chatwoot não configurado para esta chamada.");

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", api_access_token: token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const texto = await res.text();
  if (!res.ok) {
    throw new ChatwootError(res.status, texto, `${method} ${url} -> ${res.status} ${texto.slice(0, 300)}`);
  }
  return texto ? JSON.parse(texto) : null;
}

export function chatwoot(method: string, caminho: string, body?: unknown) {
  return requisitar(`${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}${caminho}`, API_TOKEN, method, body);
}

export function plataforma(method: string, caminho: string, body?: unknown) {
  return requisitar(`${BASE_URL}/platform/api/v1${caminho}`, PLATFORM_TOKEN, method, body);
}

// ---------------------------------------------------------------------------
// Tipos do payload de webhook, na forma exata que o Chatwoot 4.15 entrega
// (Conversations::EventDataPresenter e Message#webhook_data).
// ---------------------------------------------------------------------------

/** ATENÇÃO: `id` aqui é o `display_id`, não o id interno da conversa. É ele que
 *  a API aceita na URL — `find_by!(display_id: params[:id])`. */
export type ConversaWebhook = {
  id: number;
  inbox_id: number;
  status: "open" | "pending" | "resolved" | "snoozed";
  custom_attributes?: Record<string, unknown>;
  meta?: {
    sender?: { id: number; identifier?: string | null; name?: string };
    assignee?: { id: number; name?: string } | null;
  };
};

export type MensagemWebhook = {
  id: number;
  content: string | null;
  message_type: "incoming" | "outgoing" | "activity" | "template";
  private: boolean;
  created_at: number | string;
  conversation: ConversaWebhook;
  inbox: { id: number; name: string; channel_type?: string };
  sender?: { id: number; type?: string; identifier?: string | null } | null;
  source_id?: string | null;
};

export type EventoWebhook = {
  event: string;
  [k: string]: unknown;
};

/* O vocabulário de `messages.canal` no Postgres. 'outro' é a rede de segurança:
   um canal novo no Chatwoot não pode derrubar o espelho por violar o check. */
export function canalDoChatwoot(channelType: string | undefined | null): string {
  switch (channelType) {
    case "Channel::Api":
      return "app";
    case "Channel::WebWidget":
      return "site";
    case "Channel::Whatsapp":
      return "whatsapp";
    case "Channel::Email":
      return "email";
    case "Channel::Instagram":
      return "instagram";
    case "Channel::FacebookPage":
      return "facebook";
    case "Channel::Telegram":
      return "telegram";
    case "Channel::Sms":
    case "Channel::TwilioSms":
      return "sms";
    default:
      return "outro";
  }
}

/* O Chatwoot manda `snoozed`, que o nosso check não conhece. Do ponto de vista
   do produto, adiada é uma conversa que ainda não foi resolvida — então cai em
   'pending' em vez de virar erro. */
export function statusDoChatwoot(status: string | undefined): "open" | "pending" | "resolved" {
  if (status === "resolved") return "resolved";
  if (status === "pending" || status === "snoozed") return "pending";
  return "open";
}
