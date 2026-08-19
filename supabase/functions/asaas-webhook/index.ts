/* Ingresso único dos eventos do Asaas.
 *
 * Mesmo desenho do `chatwoot-webhook` e da própria ADR 001 do ledger: grava
 * cru primeiro (`registrar_evento_gateway`), responde 200, interpreta depois
 * (`processar_evento_gateway`). Um evento que falhou ao processar fica em
 * `payment_gateway_events.processing_status = 'error'` — o cron de
 * reconciliação (`reconciliar_financeiro`, de hora em hora) denuncia como
 * `stuck_gateway_event` depois de 5 minutos parado.
 *
 * Autenticação do Asaas: não é HMAC — é comparação direta do header
 * `asaas-access-token` contra um token fixo cadastrado ao registrar a URL do
 * webhook no painel do Asaas. Só isso já é frágil o bastante para exigir
 * comparação em tempo constante mesmo sendo uma string simples.
 */

import { servico, json } from "../_shared/supabase.ts";

const TOKEN_ESPERADO = Deno.env.get("ASAAS_WEBHOOK_TOKEN") ?? "";

function comparacaoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

type PagamentoAsaas = {
  id?: string;
  value?: number;
  subscription?: string | null;
};

type TransferenciaAsaas = {
  id?: string;
  status?: string;
};

type EventoAsaas = {
  id?: string;
  event?: string;
  dateCreated?: string;
  payment?: PagamentoAsaas;
  transfer?: TransferenciaAsaas;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método não suportado." }, 405);

  if (!TOKEN_ESPERADO) return json({ error: "Webhook não configurado." }, 500);
  const tokenRecebido = req.headers.get("asaas-access-token") ?? "";
  if (!comparacaoConstante(tokenRecebido, TOKEN_ESPERADO)) {
    console.warn("asaas-webhook: token recusado");
    return json({ error: "Token inválido." }, 401);
  }

  let evento: EventoAsaas;
  try {
    evento = await req.json();
  } catch {
    return json({ error: "Corpo não é JSON." }, 400);
  }

  const tipo = evento.event ?? "";
  const gatewayPaymentId = evento.payment?.id ?? "";
  const gatewayTransferId = evento.transfer?.id ?? "";
  /* Evento de transferência (TRANSFER_*) vem com `transfer`, nunca `payment` —
     os dois nomes de campo não coexistem no mesmo evento. */
  const ehTransferencia = !gatewayPaymentId && !!gatewayTransferId;
  const idExterno = gatewayPaymentId || gatewayTransferId;
  if (!tipo || !idExterno) return json({ error: "Evento incompleto." }, 400);

  /* O Asaas não manda um id de entrega dedicado — `payment.id`/`transfer.id`
     só identificam a cobrança/transferência, não o evento (PAYMENT_CONFIRMED
     e PAYMENT_RECEIVED da mesma cobrança têm o mesmo payment.id). Compor com
     o tipo e o timestamp de criação é o mesmo fallback determinístico do
     webhook do Chatwoot: repete na reentrega do mesmo evento, difere entre
     eventos distintos. */
  const eventoId = evento.id || `${tipo}:${idExterno}:${evento.dateCreated ?? ""}`;
  const ocorridoEm = evento.dateCreated ? new Date(evento.dateCreated).toISOString() : new Date().toISOString();

  const db = servico();

  if (ehTransferencia) {
    const { data: registeredId, error: erroRegistro } = await db.rpc("registrar_evento_gateway_transferencia", {
      p_gateway: "asaas",
      p_gateway_event_id: eventoId,
      p_event_type: tipo,
      p_gateway_transfer_id: gatewayTransferId,
      p_payload: evento,
      p_occurred_at: ocorridoEm,
    });
    if (erroRegistro || !registeredId) {
      console.error(`asaas-webhook: falha ao registrar evento de transferência: ${erroRegistro?.message}`);
      return json({ error: "Não foi possível registrar o evento." }, 500);
    }
    try {
      const { data: resultado, error: erroProcessar } = await db.rpc("processar_evento_gateway_transferencia", {
        p_event_id: registeredId,
      });
      if (erroProcessar) throw new Error(erroProcessar.message);
      return json({ ok: true, resultado });
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      console.error(`asaas-webhook: falha ao processar transferência ${tipo}: ${mensagem}`);
      return json({ ok: false, erro: mensagem });
    }
  }

  const { data: registeredId, error: erroRegistro } = await db.rpc("registrar_evento_gateway", {
    p_gateway: "asaas",
    p_gateway_event_id: eventoId,
    p_event_type: tipo,
    p_gateway_payment_id: gatewayPaymentId,
    p_amount: evento.payment?.value ?? null,
    p_payload: evento,
    p_occurred_at: ocorridoEm,
  });

  if (erroRegistro || !registeredId) {
    console.error(`asaas-webhook: falha ao registrar evento: ${erroRegistro?.message}`);
    return json({ error: "Não foi possível registrar o evento." }, 500);
  }

  try {
    const { data: resultado, error: erroProcessar } = await db.rpc("processar_evento_gateway", {
      p_event_id: registeredId,
    });
    if (erroProcessar) throw new Error(erroProcessar.message);
    return json({ ok: true, resultado });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.error(`asaas-webhook: falha ao processar ${tipo}: ${mensagem}`);
    // 200 de propósito: o evento está guardado e a reconciliação o enxerga.
    return json({ ok: false, erro: mensagem });
  }
});
