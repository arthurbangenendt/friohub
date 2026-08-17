/* Consumidor da `notification_outbox` para o canal WhatsApp.
 *
 * Acordado pelo `pg_cron` a cada minuto (`disparar_worker_chatwoot`, migration
 * 20260815094000). O recorte da fila NÃO está aqui: está em
 * `reservar_notificacoes_whatsapp`, no banco, porque é lá que dá para revisar e
 * testar — foi a lição escrita no cabeçalho de src/lib/notificacoes-canal.ts.
 *
 * ---------------------------------------------------------------------------
 * O texto vem de um lugar só
 * ---------------------------------------------------------------------------
 * `paraView()` é a MESMA função que o inbox do app usa. Se o WhatsApp montasse
 * o próprio texto, "Sua proposta foi aceita" no app viraria "Atualização no
 * orçamento" no WhatsApp e ninguém perceberia até um usuário reclamar.
 *
 * ---------------------------------------------------------------------------
 * Sobre ler o telefone daqui
 * ---------------------------------------------------------------------------
 * Este worker lê `profile_private.telefone` do PRÓPRIO destinatário, para
 * avisá-lo sobre algo que ele mesmo iniciou. Isso é diferente de
 * `pii_liberado_para_chatwoot()`, que trata de revelar o telefone de uma parte
 * à OUTRA — aquilo exige handoff e duplo consentimento, isto não.
 */

import { servico, json } from "../_shared/supabase.ts";
import { chatwoot } from "../_shared/chatwoot.ts";
import { paraView, type NotificacaoBruta } from "../../../src/lib/notificacoes.ts";

const WHATSAPP_INBOX_ID = Number(Deno.env.get("CHATWOOT_WHATSAPP_INBOX_ID") ?? "0");
const SITE_URL = (Deno.env.get("FRIOHUB_SITE_URL") ?? "https://friohub.vercel.app").replace(/\/+$/, "");
const LOTE = 20;

/* Fora da janela de 24h a Meta só aceita template aprovado, e o Chatwoot
   repassa a regra: sem `template_params` a mensagem é gravada como `failed`
   com "Template not found or invalid template name"
   (Whatsapp::SendOnWhatsappService). Como notificação transacional é quase
   sempre fora da janela, todo envio daqui vai como template.
   Os nomes precisam existir e estar aprovados no WhatsApp Business Manager. */
const TEMPLATE_POR_EVENTO: Record<string, string> = {
  new_message: "friohub_nova_mensagem",
  quote_request_received: "friohub_novo_orcamento",
  quote_received: "friohub_novo_orcamento",
  quote_accepted: "friohub_proposta_aceita",
  appointment_proposed: "friohub_lembrete_agendamento",
  appointment_confirmed: "friohub_lembrete_agendamento",
  appointment_reminder: "friohub_lembrete_agendamento",
  pmoc_visit_due: "friohub_lembrete_agendamento",
  job_updated: "friohub_servico_concluido",
};

type Reservada = {
  id: string;
  recipient_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown> | null;
  attempts: number;
};

Deno.serve(async () => {
  /* Sem inbox de WhatsApp configurada não há para onde entregar. Sair antes de
     reservar mantém a fila intacta em vez de queimar `attempts` de todo mundo
     até estabilizar em `failed`. */
  if (!WHATSAPP_INBOX_ID) {
    return json({ ok: true, ignorado: "CHATWOOT_WHATSAPP_INBOX_ID não configurada" });
  }

  const db = servico();

  const { data, error } = await db.rpc("reservar_notificacoes_whatsapp", { p_limite: LOTE });
  if (error) {
    console.error(`falha ao reservar: ${error.message}`);
    return json({ error: "Não foi possível reservar a fila." }, 500);
  }

  const reservadas = (data ?? []) as Reservada[];
  let enviadas = 0;
  let falhas = 0;

  for (const linha of reservadas) {
    try {
      await entregar(db, linha);
      await db.rpc("concluir_notificacao_whatsapp", { p_id: linha.id, p_enviado: true });
      enviadas++;
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      console.error(`notificação ${linha.id}: ${mensagem}`);
      await db.rpc("concluir_notificacao_whatsapp", {
        p_id: linha.id,
        p_enviado: false,
        p_erro: mensagem,
      });
      falhas++;
    }
  }

  return json({ ok: true, reservadas: reservadas.length, enviadas, falhas });
});

async function entregar(db: ReturnType<typeof servico>, linha: Reservada) {
  const view = paraView({
    id: linha.id,
    event_type: linha.event_type,
    aggregate_type: linha.aggregate_type,
    aggregate_id: linha.aggregate_id,
    payload: linha.payload,
    read_at: null,
    created_at: new Date().toISOString(),
  } satisfies NotificacaoBruta);

  const { data: privado } = await db
    .from("profile_private")
    .select("telefone")
    .eq("id", linha.recipient_id)
    .maybeSingle();

  const telefone = normalizarE164((privado as { telefone: string | null } | null)?.telefone);
  if (!telefone) throw new Error("destinatário sem telefone utilizável");

  const template = TEMPLATE_POR_EVENTO[linha.event_type];
  if (!template) throw new Error(`sem template de WhatsApp para ${linha.event_type}`);

  const contactId = await garantirContatoWhatsapp(db, linha.recipient_id, telefone);
  const displayId = await abrirConversaWhatsapp(contactId);

  await chatwoot("POST", `/conversations/${displayId}/messages`, {
    content: [view.titulo, view.detalhe, view.href ? `${SITE_URL}${view.href}` : null]
      .filter(Boolean)
      .join("\n"),
    message_type: "outgoing",
    template_params: {
      name: template,
      category: "UTILITY",
      language: "pt_BR",
      processed_params: {
        body: {
          "1": view.titulo,
          "2": view.detalhe ?? "",
          "3": view.href ? `${SITE_URL}${view.href}` : SITE_URL,
        },
      },
    },
  });
}

/* O contato do WhatsApp é o mesmo contato do marketplace — o `identifier` é o
   profile_id, único por conta. O que muda é que aqui ele PRECISA ter telefone,
   senão o Chatwoot não consegue montar o `source_id` do contact_inbox
   (ContactInboxBuilder#wa_source_id). */
async function garantirContatoWhatsapp(
  db: ReturnType<typeof servico>,
  profileId: string,
  telefone: string,
): Promise<number> {
  const { data } = await db
    .from("chatwoot_identities")
    .select("chatwoot_contact_id")
    .eq("profile_id", profileId)
    .maybeSingle();

  let contactId = (data as { chatwoot_contact_id: number | null } | null)?.chatwoot_contact_id ?? null;

  if (!contactId) {
    const { data: perfil } = await db
      .from("profiles")
      .select("nome")
      .eq("id", profileId)
      .maybeSingle();

    const criado = await chatwoot("POST", "/contacts", {
      identifier: profileId,
      name: (perfil as { nome: string } | null)?.nome ?? "Cliente FrioHub",
      phone_number: telefone,
      custom_attributes: { friohub_profile_id: profileId },
    });
    contactId = criado?.payload?.contact?.id ?? null;
    if (!contactId) throw new Error("Chatwoot não devolveu id de contato");

    await db.rpc("registrar_identidade_chatwoot", {
      p_profile_id: profileId,
      p_contact_id: contactId,
    });
  } else {
    // O contato do marketplace nasce sem telefone; para o WhatsApp ele é obrigatório.
    await chatwoot("PUT", `/contacts/${contactId}`, { phone_number: telefone });
  }

  await chatwoot("POST", `/contacts/${contactId}/contact_inboxes`, {
    inbox_id: WHATSAPP_INBOX_ID,
    source_id: telefone.replace("+", ""),
  });

  return contactId;
}

async function abrirConversaWhatsapp(contactId: number): Promise<number> {
  /* Reaproveita a conversa aberta do contato nesta inbox, se houver: cada
     notificação abrindo uma thread nova deixaria o histórico do WhatsApp
     ilegível para quem atende. */
  const existentes = await chatwoot("GET", `/contacts/${contactId}/conversations`);
  const aberta = (existentes?.payload as Array<{ id: number; inbox_id: number; status: string }> | undefined)
    ?.find((c) => c.inbox_id === WHATSAPP_INBOX_ID && c.status !== "resolved");

  if (aberta) return aberta.id;

  const criada = await chatwoot("POST", "/conversations", {
    inbox_id: WHATSAPP_INBOX_ID,
    contact_id: contactId,
    status: "open",
  });
  if (!criada?.id) throw new Error("Chatwoot não devolveu display_id da conversa de WhatsApp");
  return criada.id;
}

/* `profile_private.telefone` guarda só dígitos, no formato brasileiro (10 ou 11
   com DDD) — é o que `apenasDigitos()` grava no cadastro e o que
   `revelar_contato()` assume ao montar o link wa.me. */
function normalizarE164(telefone: string | null | undefined): string | null {
  const digitos = (telefone ?? "").replace(/\D/g, "");
  if (digitos.length === 10 || digitos.length === 11) return `+55${digitos}`;
  if (digitos.length === 12 || digitos.length === 13) return `+${digitos}`;
  return null;
}
