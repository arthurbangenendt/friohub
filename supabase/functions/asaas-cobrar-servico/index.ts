/* Cobra o cliente pelo serviço, logo depois que ele aceita uma proposta.
 *
 * Autorização: JWT do cliente, mesmo padrão de `asaas-assinar`/`asaas-cancelar`
 * — este endpoint roda com service_role e a RLS não protege quem chama.
 *
 * Chamado por `aceitarProposta` (src/app/painel/orcamentos/actions.ts) como
 * best-effort, DEPOIS de `aceitar_quote` já ter criado job/order: se esta
 * função falhar, o aceite não é desfeito — job e order já são a fonte de
 * verdade, e a cobrança fica pendente para a rotina de reconciliação
 * (`reconciliar_financeiro`) pegar depois.
 *
 * Atrás da feature flag `asaas_payments` (20260813184012_resilience_phase5.sql,
 * ligada em produção desde 20260819180000) — sem ela ligada para a região do
 * cliente, devolve `{ ok: true, skipped: true }` sem tentar nada.
 *
 * CPF/CNPJ do cliente: coletado just-in-time no aceite de proposta quando
 * ainda não existe documento salvo (Propostas.tsx + actions.ts, validado com
 * dígito verificador via src/lib/documento.ts) — não é mais um pré-requisito
 * em aberto. Cliente que ainda assim chegar aqui sem documento (ex.: aceite
 * feito antes dessa coleta existir) recebe erro explícito abaixo.
 */

import { servico, json } from "../_shared/supabase.ts";
import { criarCustomer, criarCobrancaComRecuperacao, AsaasError } from "../_shared/asaas.ts";

type Corpo = { job_id?: string };

const REGIAO_SLUG = Deno.env.get("REGIAO_SLUG") ?? "sao-paulo-sp";

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
  const jobId = typeof corpo.job_id === "string" ? corpo.job_id : "";
  if (!jobId) return json({ error: "Informe o serviço." }, 400);

  const db = servico();

  const { data: auth, error: erroAuth } = await db.auth.getUser(jwt);
  const userId = auth?.user?.id;
  if (erroAuth || !userId) return json({ error: "Sessão inválida." }, 401);

  const { data: habilitada } = await db.rpc("feature_enabled", {
    p_flag_key: "asaas_payments",
    p_region_slug: REGIAO_SLUG,
    p_subject_id: userId,
  });
  if (habilitada !== true) {
    return json({ ok: true, skipped: true });
  }

  try {
    const { data: chargeId, error: erroCharge } = await db.rpc("preparar_cobranca_servico", {
      p_job_id: jobId,
      p_cliente_id: userId,
    });
    if (erroCharge || !chargeId) {
      return json({ error: erroCharge?.message ?? "Não foi possível preparar a cobrança." }, 400);
    }

    const { data: chargesExistentes } = await db.rpc("obter_checkout_cobranca", { p_charge_id: chargeId });
    const chargeExistente = Array.isArray(chargesExistentes) ? chargesExistentes[0] : null;
    if (chargeExistente?.checkout_url) {
      return json({ ok: true, checkout_url: chargeExistente.checkout_url });
    }

    const cpfCnpj = await db.rpc("obter_cpf_cnpj_cliente", { p_user_id: userId }).then((r) => r.data as string | null);
    if (!cpfCnpj) {
      console.error(`cliente ${userId} sem cpf_cnpj — cobrança do job ${jobId} não pôde ser criada no Asaas`);
      return json({ error: "Cliente sem CPF/CNPJ cadastrado para a cobrança." }, 400);
    }

    const { data: nomePerfil } = await db.rpc("obter_nome_perfil", { p_user_id: userId });
    const { data: gatewayCustomerId } = await db.rpc("obter_payment_customer", {
      p_user_id: userId,
      p_gateway: "asaas",
    });

    let customerId = gatewayCustomerId as string | null;
    if (!customerId) {
      const customer = await criarCustomer({
        externalReference: userId,
        name: (nomePerfil as string | null) ?? "Cliente FrioHub",
        email: auth.user.email ?? "",
        cpfCnpj,
      });
      customerId = customer.id;
      const { error: erroCustomer } = await db.rpc("registrar_payment_customer", {
        p_user_id: userId,
        p_gateway: "asaas",
        p_gateway_customer_id: customer.id,
        p_external_reference: userId,
      });
      if (erroCustomer) {
        console.error(`falha ao registrar payment_customer do cliente: ${erroCustomer.message}`);
        return json({ error: "Não foi possível registrar o pagador." }, 500);
      }
    }

    const valor = Number(chargeExistente?.amount ?? 0);
    const dueDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { pagamento } = await criarCobrancaComRecuperacao(db, {
      userId,
      customerIdAtual: customerId,
      nome: (nomePerfil as string | null) ?? "Cliente FrioHub",
      email: auth.user.email ?? "",
      cpfCnpj,
      billingType: "UNDEFINED",
      value: valor,
      dueDate,
      description: "FrioHub — Pagamento do serviço",
      externalReference: chargeId,
    });

    const { error: erroVincular } = await db.rpc("vincular_cobranca_gateway", {
      p_charge_id: chargeId,
      p_gateway_payment_id: pagamento.id,
      p_checkout_url: pagamento.invoiceUrl,
      p_due_date: pagamento.dueDate,
    });
    if (erroVincular) {
      console.error(`falha ao vincular cobrança de serviço: ${erroVincular.message}`);
      return json({ error: "Cobrança criada no gateway, mas falhou ao vincular." }, 500);
    }

    return json({ ok: true, checkout_url: pagamento.invoiceUrl });
  } catch (erro) {
    if (erro instanceof AsaasError) {
      console.error(`Asaas recusou cobrança do job ${jobId}: ${erro.status} ${erro.corpo}`);
      return json({ error: "O gateway de pagamento recusou a cobrança." }, 502);
    }
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.error(`falha ao cobrar serviço ${jobId}: ${mensagem}`);
    return json({ error: "Não foi possível processar a cobrança agora." }, 500);
  }
});
