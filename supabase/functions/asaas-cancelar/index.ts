/* Profissional cancela a própria assinatura.
 *
 * Autorização: JWT do usuário verificado aqui, mesmo padrão de
 * `asaas-assinar` — este endpoint roda com service_role e a RLS não protege
 * quem chama.
 *
 * `cancelar_assinatura` decide sozinha, olhando o estado atual, entre:
 *   - ainda não pagou (pending_first_payment): cancela na hora, devolve o
 *     gateway_payment_id da fatura vinculada, se houver;
 *   - já pagou o ciclo (active/overdue): mantém acesso até next_due_date,
 *     só desliga a renovação — não há fatura para cancelar no Asaas.
 *
 * A cancelação no Asaas em si é best-effort: se falhar (fatura já vencida,
 * já paga, já removida), o cancelamento local já é a fonte de verdade e não
 * pode ficar preso esperando o gateway confirmar.
 */

import { servico, json } from "../_shared/supabase.ts";
import { cancelarCobranca, AsaasError } from "../_shared/asaas.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método não suportado." }, 405);

  const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Não autenticado." }, 401);

  const db = servico();

  const { data: auth, error: erroAuth } = await db.auth.getUser(jwt);
  const userId = auth?.user?.id;
  if (erroAuth || !userId) return json({ error: "Sessão inválida." }, 401);

  const { data: gatewayPaymentId, error: erroCancelar } = await db.rpc("cancelar_assinatura", {
    p_professional_id: userId,
  });
  if (erroCancelar) {
    return json({ error: erroCancelar.message }, 400);
  }

  if (gatewayPaymentId) {
    try {
      await cancelarCobranca(gatewayPaymentId as string);
    } catch (erro) {
      if (erro instanceof AsaasError) {
        console.error(`Asaas recusou cancelar fatura ${gatewayPaymentId}: ${erro.status} ${erro.corpo}`);
      } else {
        console.error(`falha ao cancelar fatura no Asaas: ${erro instanceof Error ? erro.message : erro}`);
      }
      // Segue OK: o cancelamento local já é definitivo. A fatura órfã no
      // Asaas, se restar, é o mesmo tipo de caso que 20260818151000 resolve.
    }
  }

  return json({ ok: true });
});
