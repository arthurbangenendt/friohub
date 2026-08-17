/* Ingresso único dos eventos do Chatwoot.
 *
 * Desenho, igual ao de `payment_gateway_events`: grava cru, responde 200,
 * interpreta depois. Interpretar antes de gravar perde o evento quando a
 * interpretação falha — e o Chatwoot NÃO reentrega webhook de conta em erro
 * (Webhooks::Trigger só faz retry para agent_bot), então um 500 aqui é uma
 * mensagem que o profissional nunca vai ver.
 *
 * Por isso a função responde 200 sempre que conseguiu REGISTRAR, mesmo quando o
 * processamento falhou: a linha fica em `error` e o health check `chatwoot_webhooks`
 * denuncia. O único caso de não-200 é assinatura inválida.
 */

import { servico, json } from "../_shared/supabase.ts";
import { verificarAssinatura } from "../_shared/assinatura.ts";
import {
  canalDoChatwoot,
  statusDoChatwoot,
  type MensagemWebhook,
  type ConversaWebhook,
} from "../_shared/chatwoot.ts";

const SEGREDO = Deno.env.get("CHATWOOT_WEBHOOK_SECRET") ?? "";

type Conversa = { id: string; cliente_id: string; professional_id: string };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método não suportado." }, 405);

  // Corpo CRU: reserializar quebra o HMAC.
  const corpoCru = await req.text();

  if (!SEGREDO) return json({ error: "Webhook não configurado." }, 500);
  const assinatura = await verificarAssinatura(req, corpoCru, SEGREDO);
  if (!assinatura.valida) {
    console.warn(`assinatura recusada: ${assinatura.motivo}`);
    return json({ error: "Assinatura inválida." }, 401);
  }

  let evento: Record<string, unknown>;
  try {
    evento = JSON.parse(corpoCru);
  } catch {
    return json({ error: "Corpo não é JSON." }, 400);
  }

  const tipo = String(evento.event ?? "");
  if (!tipo) return json({ error: "Evento sem tipo." }, 400);

  /* `X-Chatwoot-Delivery` é um uuid por entrega, preservado nas retentativas do
     Sidekiq — é a chave de idempotência certa. O fallback determinístico cobre
     versões que não mandem o header: repete entre reentregas do mesmo evento e
     difere entre eventos distintos. */
  const entrega =
    req.headers.get("x-chatwoot-delivery") ??
    `${tipo}:${(evento as { id?: number }).id ?? "s"}:${req.headers.get("x-chatwoot-timestamp") ?? ""}`;

  const db = servico();

  const { data: registro, error: erroRegistro } = await db
    .rpc("registrar_evento_chatwoot", {
      p_chatwoot_event_id: entrega,
      p_event_type: tipo,
      p_payload: evento,
      p_occurred_at: new Date().toISOString(),
    })
    .single();

  if (erroRegistro || !registro) {
    console.error(`falha ao registrar evento: ${erroRegistro?.message}`);
    return json({ error: "Não foi possível registrar o evento." }, 500);
  }

  const { event_id, status, novo } = registro as { event_id: string; status: string; novo: boolean };

  // Reentrega do que já foi resolvido: nada a fazer, e sem barulho.
  if (!novo && (status === "processed" || status === "ignored")) {
    return json({ ok: true, repetido: true });
  }

  try {
    const resultado = await processar(db, tipo, evento);
    await db.rpc("concluir_evento_chatwoot", { p_event_id: event_id, p_status: resultado });
    return json({ ok: true, resultado });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.error(`falha ao processar ${tipo}: ${mensagem}`);
    await db.rpc("concluir_evento_chatwoot", {
      p_event_id: event_id,
      p_status: "error",
      p_error: mensagem,
    });
    // 200 de propósito: o evento está guardado e o health check o enxerga.
    return json({ ok: false, erro: mensagem });
  }
});

async function processar(
  db: ReturnType<typeof servico>,
  tipo: string,
  evento: Record<string, unknown>,
): Promise<"processed" | "ignored"> {
  switch (tipo) {
    case "message_created":
      return await espelharMensagem(db, evento as unknown as MensagemWebhook);

    case "conversation_status_changed":
    case "conversation_updated":
      return await atualizarStatus(db, evento as unknown as ConversaWebhook);

    /* Edição de mensagem não é espelhada: `messages` não tem policy de UPDATE
       porque mensagem enviada não se altera — é o registro que sustenta a
       arbitragem (ver 20260812230000). Abrir isso pelo webhook contornaria a
       decisão pela porta dos fundos. */
    case "message_updated":
    case "contact_updated":
    case "conversation_created":
      return "ignored";

    default:
      return "ignored";
  }
}

async function localizarConversa(
  db: ReturnType<typeof servico>,
  displayId: number,
): Promise<Conversa | null> {
  const { data } = await db
    .from("conversations")
    .select("id, cliente_id, professional_id")
    .eq("chatwoot_conversation_id", displayId)
    .maybeSingle();
  return (data as Conversa | null) ?? null;
}

async function espelharMensagem(
  db: ReturnType<typeof servico>,
  msg: MensagemWebhook,
): Promise<"processed" | "ignored"> {
  // Nota interna é conversa da equipe sobre o caso; não pertence ao cliente.
  if (msg.private) return "ignored";
  if (msg.message_type === "activity") return "ignored";

  const displayId = msg.conversation?.id;
  if (!displayId) return "ignored";

  /* Conversa que não existe do nosso lado é atendimento da própria FrioHub
     (widget do site, WhatsApp do suporte). Essas vivem só no Chatwoot — não há
     par cliente↔profissional para espelhar. */
  const conversa = await localizarConversa(db, displayId);
  if (!conversa) return "ignored";

  const { sender_kind, sender_profile_id } = await classificarAutor(db, msg, conversa);

  const { error } = await db.rpc("espelhar_mensagem_chatwoot", {
    p_chatwoot_conversation_id: displayId,
    p_chatwoot_message_id: msg.id,
    p_body: msg.content ?? "",
    p_sender_kind: sender_kind,
    p_sender_profile_id: sender_profile_id,
    p_canal: canalDoChatwoot(msg.inbox?.channel_type),
    p_created_at: normalizarData(msg.created_at),
  });

  if (error) throw new Error(`espelhar_mensagem_chatwoot: ${error.message}`);
  return "processed";
}

/* Quem escreveu, no vocabulário do nosso schema.
 *
 * No modelo do Chatwoot o Contact é sempre o cliente, e tudo do lado do agente
 * fala com ele. O que precisa de consulta é distinguir o profissional da
 * conversa (que é agente, mas é participante) da equipe FrioHub (que é agente
 * de suporte) — os dois chegam como `outgoing` com sender do tipo user.
 */
async function classificarAutor(
  db: ReturnType<typeof servico>,
  msg: MensagemWebhook,
  conversa: Conversa,
): Promise<{ sender_kind: string; sender_profile_id: string | null }> {
  if (msg.message_type === "incoming") {
    return { sender_kind: "cliente", sender_profile_id: conversa.cliente_id };
  }

  // Saída sem autor = ação de automação do Chatwoot (send_message).
  const senderId = msg.sender?.id;
  if (!senderId || msg.sender?.type === "agent_bot") {
    return { sender_kind: "automacao", sender_profile_id: null };
  }

  /* Via principal: `chatwoot-outbound` autentica sempre com o token do agente
     de integração — o profissional não tem token próprio (ele nunca loga no
     Chatwoot, ver ADR 004). Sem esta marca, TODA resposta de profissional
     chegaria aqui como se fosse do bot de integração e cairia em 'equipe' lá
     embaixo, e `handoff_liberado()` nunca contaria o lado dele. A marca só é
     confiável porque quem a grava (chatwoot-outbound) já verificou a
     participação antes de gravar; aqui ainda cruzamos contra a conversa local
     antes de aceitar. */
  const marcado = msg.content_attributes?.friohub_sender_profile_id;
  if (marcado && marcado === conversa.professional_id) {
    return { sender_kind: "profissional", sender_profile_id: marcado };
  }

  const { data } = await db
    .from("chatwoot_identities")
    .select("profile_id")
    .eq("chatwoot_user_id", senderId)
    .maybeSingle();

  const profileId = (data as { profile_id: string } | null)?.profile_id ?? null;

  if (profileId && profileId === conversa.professional_id) {
    return { sender_kind: "profissional", sender_profile_id: profileId };
  }

  /* Agente sem vínculo com o profissional desta conversa é suporte FrioHub.
     `sender_profile_id` fica nulo mesmo quando o agente TEM profile: gravar o
     id do atendente faria `handoff_liberado()` contar a equipe como um dos dois
     lados e adiantaria a revelação do telefone. */
  return { sender_kind: "equipe", sender_profile_id: null };
}

async function atualizarStatus(
  db: ReturnType<typeof servico>,
  conversa: ConversaWebhook,
): Promise<"processed" | "ignored"> {
  if (!conversa?.id || !conversa.status) return "ignored";

  const conversaLocal = await localizarConversa(db, conversa.id);
  if (!conversaLocal) return "ignored";

  const { error } = await db.rpc("atualizar_status_conversa_chatwoot", {
    p_chatwoot_conversation_id: conversa.id,
    p_status: statusDoChatwoot(conversa.status),
  });

  if (error) throw new Error(`atualizar_status_conversa_chatwoot: ${error.message}`);
  return "processed";
}

/* `created_at` vem como epoch em segundos nas conversas e como ISO nas
   mensagens, dependendo do evento. */
function normalizarData(valor: number | string | undefined): string {
  if (typeof valor === "number") return new Date(valor * 1000).toISOString();
  if (typeof valor === "string" && valor) return new Date(valor).toISOString();
  return new Date().toISOString();
}
