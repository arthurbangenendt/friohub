import { NextResponse, type NextRequest } from "next/server";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { createClient } from "@/lib/supabase/server";
import { featureHabilitada } from "@/lib/feature-flags";
import { getOpenAI, MODELO_ASSISTENTE } from "@/lib/openai/client";
import { SYSTEM_PROMPT, formatarContextoOrcamento, type ContextoOrcamento } from "@/lib/assistente/prompt";
import { rotuloJob } from "@/app/solicitar/tipos";
import { one } from "@/lib/relacional";

export const runtime = "nodejs";

const HISTORICO_MAX = 20;
const MENSAGEM_MAX = 4000;

/** Busca o pedido via RLS do próprio profissional (nunca service role) e
 *  formata como bloco de contexto rotulado — ver `formatarContextoOrcamento`
 *  sobre por que isso nunca é concatenado como texto livre. */
async function buscarContextoOrcamento(
  supabase: Awaited<ReturnType<typeof createClient>>,
  quoteRequestId: string,
  professionalId: string,
): Promise<string | null> {
  const { data: pedido } = await supabase
    .from("quote_requests")
    .select(`job_type, urgencia, descricao, btu_recomendado,
             produto:products ( marca, modelo ),
             itens:quote_request_itens ( ambiente, area_m2 )`)
    .eq("id", quoteRequestId)
    .maybeSingle();
  if (!pedido) return null;

  const { data: minhaProposta } = await supabase
    .from("quotes")
    .select("valor_mao_obra, valor_materiais, status")
    .eq("quote_request_id", quoteRequestId)
    .eq("professional_id", professionalId)
    .maybeSingle();

  const produto = one(pedido.produto) as { marca: string; modelo: string } | null;
  const itens = (pedido.itens ?? []) as { ambiente: string; area_m2: number | null }[];
  const primeiroItem = itens[0];

  const ctx: ContextoOrcamento = {
    tipoServico: rotuloJob(pedido.job_type),
    urgencia: pedido.urgencia,
    descricaoCliente: pedido.descricao,
    ambiente: primeiroItem?.ambiente ?? null,
    areaM2: primeiroItem?.area_m2 ?? null,
    btuRecomendado: pedido.btu_recomendado,
    aparelhoCliente: produto ? `${produto.marca} ${produto.modelo}` : null,
    minhaPropostaResumo: minhaProposta
      ? `mão de obra R$ ${minhaProposta.valor_mao_obra}, materiais R$ ${minhaProposta.valor_materiais} (${minhaProposta.status})`
      : null,
  };
  return formatarContextoOrcamento(ctx);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "profissional") {
    return NextResponse.json({ error: "Assistente disponível apenas para profissionais." }, { status: 403 });
  }

  const [{ data: liberadoPeloPlano }, ligada] = await Promise.all([
    supabase.rpc("plano_permite", { p_professional_id: user.id, p_feature: "assistente" }),
    featureHabilitada(supabase, "assistente_ia", user.id),
  ]);
  if (!liberadoPeloPlano) {
    return NextResponse.json({ error: "Assistente IA é exclusivo do plano Master." }, { status: 403 });
  }
  if (!ligada) {
    return NextResponse.json({ error: "Assistente IA temporariamente indisponível." }, { status: 503 });
  }

  let body: { conversationId?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const conversationId = body.conversationId;
  const mensagem = (body.message ?? "").trim();
  if (!conversationId || !mensagem) {
    return NextResponse.json({ error: "Informe a conversa e a mensagem." }, { status: 400 });
  }
  if (mensagem.length > MENSAGEM_MAX) {
    return NextResponse.json({ error: `Mensagem muito longa (máximo ${MENSAGEM_MAX} caracteres).` }, { status: 400 });
  }

  const { error: erroLimite } = await supabase.rpc("consumir_limite_assistente");
  if (erroLimite) {
    return NextResponse.json(
      { error: "Você atingiu o limite de mensagens ao assistente por agora. Tente novamente em instantes." },
      { status: 429 },
    );
  }

  // RLS já garante que só vem linha se a conversa for do próprio usuário.
  const { data: conversa } = await supabase
    .from("assistant_conversations")
    .select("id, professional_id, quote_request_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversa) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });

  const { error: erroInsert } = await supabase
    .from("assistant_messages")
    .insert({ conversation_id: conversationId, role: "user", content: mensagem });
  if (erroInsert) return NextResponse.json({ error: "Não foi possível registrar a mensagem." }, { status: 500 });

  const { data: historico } = await supabase
    .from("assistant_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORICO_MAX);

  const mensagensOpenAI: ChatCompletionMessageParam[] = [{ role: "system", content: SYSTEM_PROMPT }];

  if (conversa.quote_request_id) {
    const contexto = await buscarContextoOrcamento(supabase, conversa.quote_request_id, user.id);
    if (contexto) mensagensOpenAI.push({ role: "system", content: contexto });
  }

  for (const m of (historico ?? []).reverse()) {
    mensagensOpenAI.push({ role: m.role as "user" | "assistant", content: m.content });
  }

  const openai = getOpenAI();
  let openAiStream: Awaited<ReturnType<typeof openai.chat.completions.create>>;
  try {
    openAiStream = await openai.chat.completions.create({
      model: MODELO_ASSISTENTE,
      messages: mensagensOpenAI,
      stream: true,
      stream_options: { include_usage: true },
    });
  } catch (e) {
    console.error("assistente/chat: falha ao chamar a OpenAI", e);
    if (e instanceof OpenAI.RateLimitError) {
      return NextResponse.json({ error: "O assistente está sobrecarregado agora. Tente novamente em instantes." }, { status: 429 });
    }
    if (e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError) {
      return NextResponse.json({ error: "Assistente mal configurado. Avise o suporte." }, { status: 500 });
    }
    return NextResponse.json({ error: "Não foi possível falar com o assistente agora." }, { status: 502 });
  }

  const encoder = new TextEncoder();
  let acumulado = "";
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of openAiStream as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            acumulado += delta;
            controller.enqueue(encoder.encode(delta));
          }
          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens;
            completionTokens = chunk.usage.completion_tokens;
          }
        }
      } catch (e) {
        console.error("assistente/chat: falha durante o streaming", e);
        // A conexão já começou — não há como trocar por um JSON de erro
        // nesta altura; o cliente trata corpo vazio/curto como falha.
      } finally {
        controller.close();
        if (acumulado) {
          // `assistant_messages.content` tem check de até 8000 caracteres —
          // sem isto, uma resposta longa da OpenAI falha o insert e some do
          // histórico sem deixar rastro (o cliente já renderizou o texto
          // inteiro via stream antes desta gravação acontecer).
          const conteudoParaSalvar = acumulado.slice(0, 8000);
          const { error: erroSalvar } = await supabase.from("assistant_messages").insert({
            conversation_id: conversationId,
            role: "assistant",
            content: conteudoParaSalvar,
            model: MODELO_ASSISTENTE,
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
          });
          if (erroSalvar) {
            console.error("assistente/chat: falha ao salvar a resposta da IA", erroSalvar);
          }
          // Qualquer UPDATE nesta linha já basta: o trigger
          // `trg_assistant_conversations_touch` reescreve `updated_at = now()`
          // sozinho, o valor enviado aqui é só para satisfazer o `.update()`.
          await supabase
            .from("assistant_conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversationId);
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
