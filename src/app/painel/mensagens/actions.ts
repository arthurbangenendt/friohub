"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { featureHabilitada } from "@/lib/feature-flags";

/* Ações do chat.
 *
 * Tudo o que envolve dado sensível passa por função no banco, nunca por escrita
 * direta: `abrir_conversa`, `marcar_conversa_lida` e `revelar_contato` estão em
 * 20260812230000_chat.sql. O telefone em particular só sai de `profile_private`
 * pela `revelar_contato`, que confere handoff liberado + consentimento dos dois.
 */

/** Abre (ou reencontra) uma conversa e registra o pedido/serviço que levou a ela. */
export async function abrirConversa(
  professionalId: string,
  contexto?: { pedidoId?: string; jobId?: string },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Faça login para enviar mensagem." };

  const { data, error } = await supabase.rpc("abrir_conversa_contextual", {
    p_professional_id: professionalId,
    p_quote_request_id: contexto?.pedidoId ?? undefined,
    p_job_id: contexto?.jobId ?? undefined,
  });
  if (error || !data) return { ok: false as const, error: error?.message ?? "Não foi possível abrir a conversa." };

  revalidatePath("/painel/mensagens");
  return { ok: true as const, conversaId: data as string };
}

export type MensagemEnviada = {
  id: string;
  sender_id: string | null;
  sender_kind: string;
  body: string;
  created_at: string;
  canal: string;
  chatwoot_message_id: number | null;
};

/** Envia e DEVOLVE a mensagem gravada.
 *
 *  Devolver a linha não é detalhe: a thread mantém as mensagens em estado local,
 *  e `revalidatePath` sozinho não atualiza `useState` já montado. Sem a linha de
 *  volta, a mensagem era gravada no banco e sumia da tela — que foi exatamente o
 *  bug relatado. O Realtime continua existindo, mas como reforço, não como única
 *  fonte.
 *
 *  Dois caminhos de escrita, escolhidos pela flag `chatwoot_messaging`:
 *
 *  · DESLIGADA — INSERT direto em `messages`, como sempre foi.
 *
 *  · LIGADA — a mensagem vai para o Chatwoot e volta pelo webhook, que é quem
 *    insere em `messages`. Assim existe uma ordem dos fatos só, e mensagem que o
 *    Chatwoot recusou não aparece na tela como enviada. O custo é que a linha
 *    real ainda não existe quando esta função retorna; devolvemos uma linha
 *    otimista carregando o `chatwoot_message_id`, que é a chave pela qual a
 *    thread reconhece a versão definitiva quando ela chega pelo Realtime.
 */
export async function enviarMensagem(conversaId: string, body: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const texto = body.trim();
  if (!texto) return { ok: false as const, error: "Escreva uma mensagem." };
  if (texto.length > 4000) return { ok: false as const, error: "Mensagem muito longa (máximo 4000 caracteres)." };

  /* A RLS já recorta: se o usuário não participa, não vem linha nenhuma. A
     consulta serve para saber de que lado ele está — é isso que define
     `sender_kind`, e é `sender_kind` (não `sender_id`) que o handoff conta. */
  const { data: conversa } = await supabase
    .from("conversations")
    .select("cliente_id, professional_id")
    .eq("id", conversaId)
    .maybeSingle();

  if (!conversa) return { ok: false as const, error: "Conversa não encontrada." };
  const senderKind = conversa.professional_id === user.id ? "profissional" : "cliente";

  if (await featureHabilitada(supabase, "chatwoot_messaging", user.id)) {
    const { data: resposta, error: erroFn } = await supabase.functions.invoke("chatwoot-outbound", {
      body: { conversa_id: conversaId, body: texto },
    });

    if (erroFn) return { ok: false as const, error: "Não foi possível enviar a mensagem agora." };

    const enviada = resposta as { chatwoot_message_id: number | null } | null;

    revalidatePath(`/painel/mensagens/${conversaId}`);
    revalidatePath("/painel/mensagens");

    return {
      ok: true as const,
      mensagem: {
        /* Id provisório: a linha definitiva nasce no espelho, com id próprio. A
           thread deduplica por `chatwoot_message_id` justamente para as duas se
           colapsarem numa só quando o Realtime entregar. */
        id: `pendente:${crypto.randomUUID()}`,
        sender_id: user.id,
        sender_kind: senderKind,
        body: texto,
        created_at: new Date().toISOString(),
        canal: "app",
        chatwoot_message_id: enviada?.chatwoot_message_id ?? null,
      } satisfies MensagemEnviada,
    };
  }

  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversaId, sender_id: user.id, sender_kind: senderKind, body: texto })
    .select("id, sender_id, sender_kind, body, created_at, canal, chatwoot_message_id")
    .single();

  if (error) return { ok: false as const, error: error.message };

  revalidatePath(`/painel/mensagens/${conversaId}`);
  revalidatePath("/painel/mensagens");
  return { ok: true as const, mensagem: data as MensagemEnviada };
}

export async function marcarLida(conversaId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.rpc("marcar_conversa_lida", { p_conversation_id: conversaId });
}

/** Registra a autorização DESTE usuário para trocar contato. Só isso — o número
 *  só aparece quando a outra parte também autorizar. */
export async function autorizarContato(conversaId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { error } = await supabase
    .from("conversation_contact_consent")
    .upsert({ conversation_id: conversaId, user_id: user.id }, { onConflict: "conversation_id,user_id" });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath(`/painel/mensagens/${conversaId}`);
  return { ok: true as const };
}

export type Contato = { nome: string | null; telefone: string | null; whatsappUrl: string | null };

/** Busca o contato da outra parte. A função no banco levanta exceção quando o
 *  handoff não está liberado ou falta consentimento — a mensagem dela é o que o
 *  usuário lê. */
export async function buscarContato(conversaId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revelar_contato", { p_conversation_id: conversaId });
  if (error) return { ok: false as const, error: error.message };

  const linha = (Array.isArray(data) ? data[0] : data) as
    | { nome: string | null; telefone: string | null; whatsapp_url: string | null }
    | undefined;
  if (!linha) return { ok: false as const, error: "Contato indisponível." };

  return {
    ok: true as const,
    contato: { nome: linha.nome, telefone: linha.telefone, whatsappUrl: linha.whatsapp_url } satisfies Contato,
  };
}
