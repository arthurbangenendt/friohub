/* Escrita: mensagem sai do app FrioHub e entra no Chatwoot.
 *
 * Caminho único de escrita. O app NÃO insere mais em `messages` direto — quem
 * insere é o webhook, espelhando o que o Chatwoot confirmou. Assim existe uma
 * única ordem dos fatos, e uma mensagem que o Chatwoot recusou não aparece na
 * tela como se tivesse sido enviada.
 *
 * Autorização: o JWT do usuário é verificado aqui e a participação na conversa
 * é conferida contra o banco. Não dá para confiar no `conversa_id` que veio no
 * corpo — este endpoint roda com service_role e a RLS não protege quem chama.
 */

import { servico, json } from "../_shared/supabase.ts";
import { chatwoot } from "../_shared/chatwoot.ts";
import { garantirConversa, type ConversaLocal } from "../_shared/provisionamento.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método não suportado." }, 405);

  const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Não autenticado." }, 401);

  let corpo: { conversa_id?: string; body?: string };
  try {
    corpo = await req.json();
  } catch {
    return json({ error: "Dados inválidos." }, 400);
  }

  const conversaId = typeof corpo.conversa_id === "string" ? corpo.conversa_id : "";
  const texto = typeof corpo.body === "string" ? corpo.body.trim() : "";

  if (!conversaId) return json({ error: "Conversa não informada." }, 400);
  /* Mesmo limite do check de `messages.body` (20260812230000): recusar aqui dá
     erro claro em vez de estourar lá no fim, depois de já ter ido ao Chatwoot. */
  if (texto.length < 1 || texto.length > 4000) {
    return json({ error: "A mensagem precisa ter entre 1 e 4000 caracteres." }, 400);
  }

  const db = servico();

  const { data: auth, error: erroAuth } = await db.auth.getUser(jwt);
  const userId = auth?.user?.id;
  if (erroAuth || !userId) return json({ error: "Sessão inválida." }, 401);

  const { data, error } = await db
    .from("conversations")
    .select("id, cliente_id, professional_id, chatwoot_conversation_id")
    .eq("id", conversaId)
    .maybeSingle();

  const conversa = data as ConversaLocal | null;
  if (error || !conversa) return json({ error: "Conversa não encontrada." }, 404);

  const ehCliente = conversa.cliente_id === userId;
  const ehProfissional = conversa.professional_id === userId;
  if (!ehCliente && !ehProfissional) {
    return json({ error: "Você não participa desta conversa." }, 403);
  }

  /* O trigger de rate limit em `messages` só age quando há `auth.uid()`, e a
     inserção agora é do worker. Sem esta chamada o teto de 30/min e 500/dia
     simplesmente deixaria de existir. Ver 20260815096000. */
  const { error: erroLimite } = await db.rpc("consumir_limite_mensagem", { p_user_id: userId });
  if (erroLimite) {
    return json({ error: "Limite de mensagens excedido. Aguarde um instante." }, 429);
  }

  try {
    const displayId = await garantirConversa(db, conversa);

    /* No modelo do Chatwoot o Contact é o cliente e o agente é o profissional.
       `incoming` = veio do contato; `outgoing` = veio do lado do agente. É essa
       distinção que o webhook usa depois para classificar `sender_kind` — mas
       só para o lado cliente. Do lado profissional NÃO basta: esta função
       autentica sempre com o token do agente de integração (o profissional não
       tem token próprio — é a proteção #2 do ADR 004, ele nunca loga no
       Chatwoot), então, sem mais nada, TODA resposta de profissional seria
       atribuída ao bot de integração e o webhook a classificaria como
       'equipe'. Isso quebraria `handoff_liberado()` de vez: nenhuma resposta
       de profissional contaria como "o lado dele falou", e a regra de 4 dias
       nunca seria cumprida por conversa nenhuma vinda do Chatwoot.
       `content_attributes.friohub_sender_profile_id` carrega quem de fato
       está autenticado aqui — já verificado acima como participante da
       conversa — e o webhook usa isso para classificar corretamente antes de
       cair no fallback por `chatwoot_user_id`. */
    const mensagem = await chatwoot("POST", `/conversations/${displayId}/messages`, {
      content: texto,
      message_type: ehCliente ? "incoming" : "outgoing",
      private: false,
      content_attributes: { friohub_sender_profile_id: userId },
    });

    return json({
      ok: true,
      chatwoot_message_id: mensagem?.id ?? null,
      chatwoot_conversation_id: displayId,
    });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.error(`falha ao enviar para o Chatwoot: ${mensagem}`);
    return json({ error: "Não foi possível enviar a mensagem agora." }, 502);
  }
});
