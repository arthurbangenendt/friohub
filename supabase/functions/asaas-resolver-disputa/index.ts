/* Aprova uma disputa (contestação pós-conclusão ou cancelamento de job pago
 * em execução): estorna de verdade no Asaas cada cobrança do plano montado
 * por `preparar_reembolso_disputa`, e fecha o ciclo com
 * `confirmar_reembolso_disputa`.
 *
 * Rejeitar uma disputa NÃO passa por aqui — é síncrono direto na RPC
 * `resolver_disputa_rejeitar`, chamada pela action do admin sem precisar de
 * gateway nenhum.
 *
 * Autorização: JWT do admin (mesmo padrão de `asaas-cobrar-servico`) — a
 * checagem de `role = 'admin'` acontece aqui E de novo dentro da RPC
 * (defesa em profundidade, já que a RPC só é executável por `service_role`).
 */

import { servico, json } from "../_shared/supabase.ts";
import { estornarCobranca, AsaasError } from "../_shared/asaas.ts";

type Corpo = { dispute_id?: string; valor_reembolso?: number; nota_admin?: string };
type PlanoItem = { charge_id: string; gateway_payment_id: string; valor: number };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método não suportado." }, 405);

  const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Não autenticado." }, 401);

  let corpo: Corpo;
  try {
    corpo = await req.json();
  } catch {
    return json({ error: "Dados inválidos." }, 400);
  }
  const disputeId = typeof corpo.dispute_id === "string" ? corpo.dispute_id : "";
  const valorReembolso = typeof corpo.valor_reembolso === "number" ? corpo.valor_reembolso : NaN;
  const notaAdmin = typeof corpo.nota_admin === "string" ? corpo.nota_admin : "";
  if (!disputeId || !Number.isFinite(valorReembolso) || valorReembolso <= 0) {
    return json({ error: "Informe a disputa e um valor de reembolso válido." }, 400);
  }

  const db = servico();

  const { data: auth, error: erroAuth } = await db.auth.getUser(jwt);
  const userId = auth?.user?.id;
  if (erroAuth || !userId) return json({ error: "Sessão inválida." }, 401);

  const { data: perfil } = await db.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (perfil?.role !== "admin") return json({ error: "Apenas administradores podem resolver disputas." }, 403);

  const { data: plano, error: erroPrepara } = await db.rpc("preparar_reembolso_disputa", {
    p_dispute_id: disputeId,
    p_valor_reembolso: valorReembolso,
    p_admin_id: userId,
    p_nota_admin: notaAdmin,
  });
  if (erroPrepara) {
    return json({ error: erroPrepara.message }, 400);
  }

  const itens = (plano ?? []) as PlanoItem[];
  const resultados: { charge_id: string; valor: number; sucesso: boolean; erro: string | null }[] = [];

  for (const item of itens) {
    try {
      await estornarCobranca(item.gateway_payment_id, item.valor);
      resultados.push({ charge_id: item.charge_id, valor: item.valor, sucesso: true, erro: null });
    } catch (erro) {
      const mensagem = erro instanceof AsaasError
        ? `Asaas recusou: ${erro.status} ${erro.corpo}`
        : erro instanceof Error ? erro.message : String(erro);
      console.error(`asaas-resolver-disputa: falha ao estornar cobrança ${item.charge_id} (disputa ${disputeId}): ${mensagem}`);
      resultados.push({ charge_id: item.charge_id, valor: item.valor, sucesso: false, erro: mensagem });
    }
  }

  const { error: erroConfirma } = await db.rpc("confirmar_reembolso_disputa", {
    p_dispute_id: disputeId,
    p_resultados: resultados,
  });
  if (erroConfirma) {
    console.error(`asaas-resolver-disputa: falha ao confirmar disputa ${disputeId}: ${erroConfirma.message}`);
    return json({ error: "Estorno processado no gateway, mas falhou ao confirmar no banco — verifique manualmente." }, 500);
  }

  const algumFalhou = resultados.some((r) => !r.sucesso);
  if (algumFalhou) {
    return json({ ok: false, error: "Um ou mais estornos falharam no gateway — revise a disputa manualmente.", resultados }, 502);
  }

  return json({ ok: true, resultados });
});
