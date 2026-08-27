"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/* Ações do assistente que não envolvem streaming (isso fica na rota de chat,
   `/api/assistente/chat`). Criar/listar/apagar conversa é dado comum — RLS de
   `assistant_conversations` já garante que cada profissional só mexe na
   própria. */

export type Conversa = {
  id: string;
  title: string;
  quote_request_id: string | null;
  updated_at: string;
};

export async function listarConversas() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { data, error } = await supabase
    .from("assistant_conversations")
    .select("id, title, quote_request_id, updated_at")
    .order("updated_at", { ascending: false });
  if (error) return { ok: false as const, error: error.message };

  return { ok: true as const, conversas: (data ?? []) as Conversa[] };
}

/** Cria a conversa. Se `quoteRequestId` vier, é o modo triagem — o título já
 *  nasce identificando o pedido para a lista não mostrar "Nova conversa"
 *  repetido. */
export async function criarConversa(quoteRequestId?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { data, error } = await supabase
    .from("assistant_conversations")
    .insert({
      professional_id: user.id,
      quote_request_id: quoteRequestId ?? null,
      title: quoteRequestId ? "Análise de orçamento" : "Nova conversa",
    })
    .select("id, title, quote_request_id, updated_at")
    .single();
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/assistente");
  return { ok: true as const, conversa: data as Conversa };
}

export async function apagarConversa(conversationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { error } = await supabase
    .from("assistant_conversations")
    .delete()
    .eq("id", conversationId);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/assistente");
  return { ok: true as const };
}

export type MensagemAssistente = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

export async function listarMensagens(conversationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { data, error } = await supabase
    .from("assistant_messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) return { ok: false as const, error: error.message };

  return { ok: true as const, mensagens: (data ?? []) as MensagemAssistente[] };
}
