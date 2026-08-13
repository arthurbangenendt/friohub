"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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

/** Envia e DEVOLVE a mensagem gravada.
 *
 *  Devolver a linha não é detalhe: a thread mantém as mensagens em estado local,
 *  e `revalidatePath` sozinho não atualiza `useState` já montado. Sem a linha de
 *  volta, a mensagem era gravada no banco e sumia da tela — que foi exatamente o
 *  bug relatado. O Realtime continua existindo, mas como reforço, não como única
 *  fonte. */
export async function enviarMensagem(conversaId: string, body: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const texto = body.trim();
  if (!texto) return { ok: false as const, error: "Escreva uma mensagem." };
  if (texto.length > 4000) return { ok: false as const, error: "Mensagem muito longa (máximo 4000 caracteres)." };

  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversaId, sender_id: user.id, body: texto })
    .select("id, sender_id, body, created_at")
    .single();

  if (error) return { ok: false as const, error: error.message };

  revalidatePath(`/painel/mensagens/${conversaId}`);
  revalidatePath("/painel/mensagens");
  return { ok: true as const, mensagem: data as { id: string; sender_id: string; body: string; created_at: string } };
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
