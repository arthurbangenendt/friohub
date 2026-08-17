/* Verificação da assinatura do webhook do Chatwoot.
 *
 * O formato saiu de lib/webhooks/trigger.rb (v4.15.1):
 *
 *   X-Chatwoot-Timestamp: <epoch em segundos>
 *   X-Chatwoot-Signature: sha256=<HMAC_SHA256(secret, "{timestamp}.{corpo cru}")>
 *
 * Duas coisas que precisam estar certas ou a verificação vira teatro:
 *
 *   · o corpo tem que ser o CRU (`req.text()`), nunca `req.json()` reserializado
 *     — a ordem das chaves e o espaçamento mudam, e o HMAC muda junto;
 *
 *   · a comparação tem que ser em tempo constante. Comparar com `===` vazaria,
 *     pelo tempo de resposta, quantos bytes iniciais o atacante acertou.
 *
 * A janela de tolerância existe contra replay: um POST capturado continua com
 * assinatura válida para sempre, já que o segredo não muda.
 */

const JANELA_SEGUNDOS = 300;

function comparacaoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) {
    diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferenca === 0;
}

async function hmacHex(segredo: string, mensagem: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinatura = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(mensagem));
  return Array.from(new Uint8Array(assinatura))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type ResultadoAssinatura = { valida: true } | { valida: false; motivo: string };

export async function verificarAssinatura(
  req: Request,
  corpoCru: string,
  segredo: string,
): Promise<ResultadoAssinatura> {
  const assinatura = req.headers.get("x-chatwoot-signature");
  const timestamp = req.headers.get("x-chatwoot-timestamp");

  if (!assinatura || !timestamp) return { valida: false, motivo: "assinatura ausente" };

  const idade = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(idade) || idade > JANELA_SEGUNDOS) {
    return { valida: false, motivo: "timestamp fora da janela" };
  }

  const esperada = `sha256=${await hmacHex(segredo, `${timestamp}.${corpoCru}`)}`;
  return comparacaoConstante(assinatura, esperada)
    ? { valida: true }
    : { valida: false, motivo: "assinatura não confere" };
}

/* Identidade do widget: HMAC do `identifier` com o `hmac_token` da inbox.
 * Vive aqui, e não no app, porque o token é segredo de servidor — se ele for
 * para o browser, `setUser()` deixa de provar coisa alguma. */
export function identifierHash(hmacToken: string, identifier: string): Promise<string> {
  return hmacHex(hmacToken, identifier);
}
