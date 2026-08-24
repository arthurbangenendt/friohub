/* Cobra o ciclo N+1 das assinaturas vencidas (renovação automática).
 *
 * Acordado por `disparar_worker_renovacao_assinaturas()` via pg_net uma vez
 * por dia (20260819190000_worker_renovacao_assinatura.sql) — não recebe JWT
 * de usuário, só a chave guardada no Vault
 * (`assinaturas_renovacao_worker_key`), mesmo padrão de
 * `asaas-processar-repasses`.
 *
 * Duas chamadas antes de processar qualquer coisa:
 *   1. `aplicar_ciclo_assinaturas_vencidas()` — cancela quem marcou
 *      `auto_renova = false` e aplica downgrade agendado (`proximo_plano_id`)
 *      em quem vai renovar. Depois disso, `listar_assinaturas_prontas_para_renovar`
 *      só vê quem de fato precisa de uma cobrança nova.
 *   2. `listar_assinaturas_prontas_para_renovar` RESERVA (renewal_claimed_at)
 *      cada linha antes de qualquer chamada ao Asaas — mesmo raciocínio do
 *      `listar_repasses_prontos`.
 *
 * A chave de idempotência é `subscription_id:next_due_date` (o CICLO, não o
 * dia em que o worker rodou) — ver comentário no topo da migration.
 */

import { servico, json } from "../_shared/supabase.ts";
import { criarCustomer, criarCobrancaComRecuperacao, AsaasError } from "../_shared/asaas.ts";

const WORKER_KEY = Deno.env.get("ASSINATURAS_RENOVACAO_WORKER_KEY") ?? "";

type AssinaturaFila = {
  subscription_id: string;
  professional_id: string;
  plan_id: string;
  amount: number;
  ciclo: "mensal" | "anual";
  next_due_date: string;
};

function comparacaoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método não suportado." }, 405);

  if (!WORKER_KEY) return json({ error: "Worker não configurado." }, 500);
  const chaveRecebida = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!comparacaoConstante(chaveRecebida, WORKER_KEY)) {
    return json({ error: "Não autorizado." }, 401);
  }

  const db = servico();

  const { error: erroCiclo } = await db.rpc("aplicar_ciclo_assinaturas_vencidas");
  if (erroCiclo) {
    console.error(`asaas-renovar-assinaturas: falha ao aplicar cancelamento/downgrade: ${erroCiclo.message}`);
    return json({ error: erroCiclo.message }, 500);
  }

  const { data: fila, error: erroFila } = await db.rpc("listar_assinaturas_prontas_para_renovar", { p_limit: 20 });
  if (erroFila) {
    console.error(`asaas-renovar-assinaturas: falha ao listar fila: ${erroFila.message}`);
    return json({ error: erroFila.message }, 500);
  }

  const assinaturas = (fila ?? []) as AssinaturaFila[];
  let processados = 0;
  let falhas = 0;

  for (const assinatura of assinaturas) {
    try {
      const idempotencyKey = `${assinatura.subscription_id}:${assinatura.next_due_date}`;

      const { data: chargeId, error: erroCharge } = await db.rpc("preparar_cobranca_renovacao", {
        p_subscription_id: assinatura.subscription_id,
        p_gateway: "asaas",
        p_billing_type: "UNDEFINED",
        p_idempotency_key: idempotencyKey,
      });
      if (erroCharge || !chargeId) {
        throw new Error(erroCharge?.message ?? "Não foi possível preparar a cobrança de renovação.");
      }

      const { data: chargesExistentes } = await db.rpc("obter_checkout_cobranca", { p_charge_id: chargeId });
      const chargeExistente = Array.isArray(chargesExistentes) ? chargesExistentes[0] : null;
      if (chargeExistente?.checkout_url) {
        // Já tem cobrança criada no Asaas para este ciclo (execução anterior
        // chegou até aqui) — não cria uma segunda fatura para a mesma coisa.
        processados++;
        continue;
      }

      const { data: cpfCnpj } = await db.rpc("obter_cpf_cnpj_professional", { p_user_id: assinatura.professional_id });
      if (!cpfCnpj) {
        throw new Error(`profissional ${assinatura.professional_id} sem CPF/CNPJ salvo — não deveria acontecer para quem já pagou o ciclo 1`);
      }

      const { data: nomePerfil } = await db.rpc("obter_nome_perfil", { p_user_id: assinatura.professional_id });
      const { data: authUser } = await db.auth.admin.getUserById(assinatura.professional_id);
      const { data: gatewayCustomerId } = await db.rpc("obter_payment_customer", {
        p_user_id: assinatura.professional_id,
        p_gateway: "asaas",
      });

      let customerId = gatewayCustomerId as string | null;
      if (!customerId) {
        const customer = await criarCustomer({
          externalReference: assinatura.professional_id,
          name: (nomePerfil as string | null) ?? "Profissional FrioHub",
          email: authUser?.user?.email ?? "",
          cpfCnpj: cpfCnpj as string,
        });
        customerId = customer.id;
        const { error: erroCustomer } = await db.rpc("registrar_payment_customer", {
          p_user_id: assinatura.professional_id,
          p_gateway: "asaas",
          p_gateway_customer_id: customer.id,
          p_external_reference: assinatura.professional_id,
        });
        if (erroCustomer) throw new Error(`falha ao registrar payment_customer: ${erroCustomer.message}`);
      }

      const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { pagamento } = await criarCobrancaComRecuperacao(db, {
        userId: assinatura.professional_id,
        customerIdAtual: customerId,
        nome: (nomePerfil as string | null) ?? "Profissional FrioHub",
        email: authUser?.user?.email ?? "",
        cpfCnpj: cpfCnpj as string,
        billingType: "UNDEFINED",
        value: assinatura.amount,
        dueDate,
        description: `FrioHub — renovação da assinatura (venc. ${assinatura.next_due_date})`,
        externalReference: chargeId,
      });

      const { error: erroVincular } = await db.rpc("vincular_cobranca_gateway", {
        p_charge_id: chargeId,
        p_gateway_payment_id: pagamento.id,
        p_checkout_url: pagamento.invoiceUrl,
        p_due_date: pagamento.dueDate,
      });
      if (erroVincular) {
        // Cobrança já foi criada no Asaas; só não conseguimos vincular
        // localmente. Não tenta de novo agora — reprocessar cairia no
        // `chargeExistente` vazio de novo e criaria uma SEGUNDA fatura no
        // Asaas. Fica para reconciliação manual usando o gateway_payment_id
        // logado abaixo.
        throw new Error(`cobrança ${pagamento.id} criada no Asaas mas falhou ao vincular: ${erroVincular.message}`);
      }

      processados++;
    } catch (erro) {
      const mensagem = erro instanceof AsaasError
        ? `Asaas recusou: ${erro.status} ${erro.corpo}`
        : erro instanceof Error ? erro.message : String(erro);
      console.error(`asaas-renovar-assinaturas: falha na assinatura ${assinatura.subscription_id}: ${mensagem}`);
      falhas++;
    }
  }

  return json({ ok: true, total: assinaturas.length, processados, falhas });
});
