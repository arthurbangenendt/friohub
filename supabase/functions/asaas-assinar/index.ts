/* Profissional assina um plano: abre a assinatura local e a primeira cobrança
 * no Asaas, devolve o link de pagamento.
 *
 * Autorização: JWT do usuário verificado aqui, igual a `chatwoot-outbound` —
 * este endpoint roda com service_role e a RLS não protege quem chama.
 *
 * O ciclo de vida completo:
 *   1. `preparar_assinatura_plano` cria (ou devolve, se já existir) o
 *      compromisso local `plan_subscriptions`.
 *   2. Garante um customer no Asaas (busca por externalReference = profile
 *      id; cria se não existir) — exige CPF/CNPJ, coletado aqui na primeira
 *      vez e persistido em `professionals.cpf_cnpj` para não pedir de novo.
 *   3. `preparar_cobranca_assinatura` cria a `payment_charge` local,
 *      idempotente pela chave `subscription_id + tentativa do dia`.
 *   4. Cria a cobrança no Asaas e vincula o id retornado.
 *
 * Cobranças seguintes (ciclo 2, 3, ...) NÃO passam por aqui — são um worker
 * agendado ainda não construído (ver comentário na migration 20260818140000).
 */

import { servico, json } from "../_shared/supabase.ts";
import { criarCustomer, criarCobranca, AsaasError } from "../_shared/asaas.ts";

type Corpo = {
  plano_slug?: string;
  ciclo?: "mensal" | "anual";
  cpf_cnpj?: string;
};

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

  const planoSlug = typeof corpo.plano_slug === "string" ? corpo.plano_slug.trim() : "";
  const ciclo = corpo.ciclo === "anual" ? "anual" : corpo.ciclo === "mensal" ? "mensal" : null;
  const cpfCnpjBruto = typeof corpo.cpf_cnpj === "string" ? corpo.cpf_cnpj.replace(/\D/g, "") : "";

  if (!planoSlug) return json({ error: "Informe o plano." }, 400);
  if (!ciclo) return json({ error: "Ciclo inválido." }, 400);

  const db = servico();

  const { data: auth, error: erroAuth } = await db.auth.getUser(jwt);
  const userId = auth?.user?.id;
  if (erroAuth || !userId) return json({ error: "Sessão inválida." }, 401);

  /* `obter_cpf_cnpj_professional` devolve null tanto para "não é profissional"
     quanto para "profissional sem documento ainda" — os dois casos seguem
     caminhos diferentes abaixo, então a distinção vem de uma checagem à parte. */
  const { data: cpfCnpjSalvo, error: erroProfissional } = await db.rpc(
    "obter_cpf_cnpj_professional",
    { p_user_id: userId },
  );
  if (erroProfissional) {
    return json({ error: "Apenas perfis de profissional podem assinar um plano." }, 403);
  }

  const cpfCnpj = (cpfCnpjSalvo as string | null) ?? (cpfCnpjBruto || null);
  if (!cpfCnpj || (cpfCnpj.length !== 11 && cpfCnpj.length !== 14)) {
    return json({ error: "Informe um CPF ou CNPJ válido para assinar." }, 400);
  }
  if (!cpfCnpjSalvo) {
    await db.rpc("definir_cpf_cnpj_professional", { p_user_id: userId, p_cpf_cnpj: cpfCnpj });
  }

  const { data: planos, error: erroPlano } = await db.rpc("obter_plano_publico", { p_slug: planoSlug });
  const plano = Array.isArray(planos) ? planos[0] : null;
  if (erroPlano || !plano) return json({ error: "Plano indisponível." }, 404);

  const { data: subscriptionId, error: erroSub } = await db.rpc("preparar_assinatura_plano", {
    p_professional_id: userId,
    p_plan_id: plano.id,
    p_ciclo: ciclo,
  });
  if (erroSub || !subscriptionId) {
    return json({ error: erroSub?.message ?? "Não foi possível abrir a assinatura." }, 400);
  }

  const { data: nomePerfil } = await db.rpc("obter_nome_perfil", { p_user_id: userId });
  const { data: authUser } = await db.auth.admin.getUserById(userId);

  try {
    const { data: gatewayCustomerId } = await db.rpc("obter_payment_customer", {
      p_user_id: userId,
      p_gateway: "asaas",
    });

    let customerId = gatewayCustomerId as string | null;
    if (!customerId) {
      const customer = await criarCustomer({
        externalReference: userId,
        name: (nomePerfil as string | null) ?? "Profissional FrioHub",
        email: authUser?.user?.email ?? "",
        cpfCnpj: cpfCnpj,
      });
      customerId = customer.id;
      const { error: erroCustomer } = await db.rpc("registrar_payment_customer", {
        p_user_id: userId,
        p_gateway: "asaas",
        p_gateway_customer_id: customer.id,
        p_external_reference: userId,
      });
      if (erroCustomer) {
        console.error(`falha ao registrar payment_customer: ${erroCustomer.message}`);
        return json({ error: "Não foi possível registrar o pagador. Contate o suporte." }, 500);
      }
    }

    const hoje = new Date().toISOString().slice(0, 10);
    const idempotencyKey = `${subscriptionId}:${hoje}`;

    const { data: chargeId, error: erroCharge } = await db.rpc("preparar_cobranca_assinatura", {
      p_subscription_id: subscriptionId,
      p_gateway: "asaas",
      p_billing_type: "UNDEFINED",
      p_idempotency_key: idempotencyKey,
    });
    if (erroCharge || !chargeId) {
      return json({ error: erroCharge?.message ?? "Não foi possível preparar a cobrança." }, 400);
    }

    const { data: chargesExistentes } = await db.rpc("obter_checkout_cobranca", { p_charge_id: chargeId });
    const chargeExistente = Array.isArray(chargesExistentes) ? chargesExistentes[0] : null;
    if (chargeExistente?.checkout_url) {
      return json({ ok: true, checkout_url: chargeExistente.checkout_url, subscription_id: subscriptionId });
    }

    const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const pagamento = await criarCobranca({
      customerId,
      billingType: "UNDEFINED",
      value: ciclo === "mensal" ? plano.preco_mensal : plano.preco_anual,
      dueDate,
      description: `FrioHub — Plano ${plano.nome} (${ciclo})`,
      externalReference: chargeId,
    });

    const { error: erroVincular } = await db.rpc("vincular_cobranca_gateway", {
      p_charge_id: chargeId,
      p_gateway_payment_id: pagamento.id,
      p_checkout_url: pagamento.invoiceUrl,
      p_due_date: pagamento.dueDate,
    });
    if (erroVincular) {
      console.error(`falha ao vincular cobrança de assinatura: ${erroVincular.message}`);
      return json({ error: "Cobrança criada no gateway, mas falhou ao vincular. Contate o suporte." }, 500);
    }

    return json({ ok: true, checkout_url: pagamento.invoiceUrl, subscription_id: subscriptionId });
  } catch (erro) {
    if (erro instanceof AsaasError) {
      console.error(`Asaas recusou: ${erro.status} ${erro.corpo}`);
      return json({ error: "O gateway de pagamento recusou a cobrança. Verifique os dados e tente novamente." }, 502);
    }
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.error(`falha ao assinar plano: ${mensagem}`);
    return json({ error: "Não foi possível processar a assinatura agora." }, 500);
  }
});
