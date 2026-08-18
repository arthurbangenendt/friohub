/* Cliente da API do Asaas.
 *
 * Uma autenticação só: header `access_token` com a API key (sandbox ou
 * produção — a key em si já diz qual ambiente é; não há troca de header).
 * Nada aqui roda no browser: a key é de servidor.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const AMBIENTE = Deno.env.get("ASAAS_ENV") === "production" ? "producao" : "sandbox";
export const BASE_URL = AMBIENTE === "producao"
  ? "https://api.asaas.com/v3"
  : "https://api-sandbox.asaas.com/v3";

const API_KEY = Deno.env.get("ASAAS_API_KEY") ?? "";

export class AsaasError extends Error {
  constructor(readonly status: number, readonly corpo: string, mensagem: string) {
    super(mensagem);
    this.name = "AsaasError";
  }
}

async function requisitar(method: string, caminho: string, body?: unknown) {
  if (!API_KEY) throw new Error("ASAAS_API_KEY não configurada.");

  const res = await fetch(`${BASE_URL}${caminho}`, {
    method,
    headers: { "Content-Type": "application/json", access_token: API_KEY },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const texto = await res.text();
  if (!res.ok) {
    throw new AsaasError(res.status, texto, `${method} ${caminho} -> ${res.status} ${texto.slice(0, 300)}`);
  }
  return texto ? JSON.parse(texto) : null;
}

export function asaas(method: string, caminho: string, body?: unknown) {
  return requisitar(method, caminho, body);
}

// ---------------------------------------------------------------------------
// Formato mínimo do que a integração usa. O Asaas devolve muito mais campo
// por objeto; só nomeamos o que efetivamente lemos.
// ---------------------------------------------------------------------------

export type AsaasCustomer = {
  id: string;
  cpfCnpj?: string;
};

export type AsaasPayment = {
  id: string;
  status: string;
  invoiceUrl: string;
  dueDate: string;
};

export async function criarCustomer(params: {
  externalReference: string;
  name: string;
  email: string;
  cpfCnpj: string;
}): Promise<AsaasCustomer> {
  return await asaas("POST", "/customers", {
    name: params.name,
    email: params.email,
    cpfCnpj: params.cpfCnpj,
    externalReference: params.externalReference,
  }) as AsaasCustomer;
}

export async function criarCobranca(params: {
  customerId: string;
  billingType: "UNDEFINED" | "PIX" | "BOLETO" | "CREDIT_CARD";
  value: number;
  dueDate: string;
  description: string;
  externalReference: string;
}): Promise<AsaasPayment> {
  return await asaas("POST", "/payments", {
    customer: params.customerId,
    billingType: params.billingType,
    value: params.value,
    dueDate: params.dueDate,
    description: params.description,
    externalReference: params.externalReference,
  }) as AsaasPayment;
}

/* Cancela uma fatura ainda não paga no Asaas. `DELETE /payments/{id}` recusa
 * cobrança já liquidada — nunca chame isto para uma fatura com status
 * `received`/`confirmed` no gateway; é só para o rastro de faturas
 * pendentes que a gente decidiu abandonar do nosso lado. */
export async function cancelarCobranca(gatewayPaymentId: string): Promise<void> {
  await asaas("DELETE", `/payments/${gatewayPaymentId}`);
}

/* Achado testando em produção: um customer apagado manualmente no painel do
 * Asaas (sandbox) deixa `payment_customers.gateway_customer_id` local
 * apontando para um id que não existe mais lá. `POST /payments` recusa com
 * `invalid_customer` — "Não é possível criar uma cobrança para um cliente
 * removido." Não há endpoint barato para checar existência antes; a forma
 * de detectar é tentar e reagir ao erro específico. */
export function clienteRemovido(erro: unknown): boolean {
  return erro instanceof AsaasError && erro.corpo.includes("invalid_customer");
}

/* Cria a cobrança e, se o customer salvo estiver órfão no Asaas (removido do
 * lado de lá sem a gente saber), recria o customer, atualiza
 * `payment_customers` e tenta de novo — uma vez. Usado tanto por
 * `asaas-assinar` quanto por `asaas-trocar-plano`, que compartilham o mesmo
 * risco de customer desatualizado. */
export async function criarCobrancaComRecuperacao(
  db: SupabaseClient,
  params: {
    userId: string;
    customerIdAtual: string;
    nome: string;
    email: string;
    cpfCnpj: string;
    billingType: "UNDEFINED" | "PIX" | "BOLETO" | "CREDIT_CARD";
    value: number;
    dueDate: string;
    description: string;
    externalReference: string;
  },
): Promise<{ pagamento: AsaasPayment; customerId: string }> {
  try {
    const pagamento = await criarCobranca({ customerId: params.customerIdAtual, ...params });
    return { pagamento, customerId: params.customerIdAtual };
  } catch (erro) {
    if (!clienteRemovido(erro)) throw erro;

    const novoCustomer = await criarCustomer({
      externalReference: params.userId,
      name: params.nome,
      email: params.email,
      cpfCnpj: params.cpfCnpj,
    });
    const { error } = await db.rpc("registrar_payment_customer", {
      p_user_id: params.userId,
      p_gateway: "asaas",
      p_gateway_customer_id: novoCustomer.id,
      p_external_reference: params.userId,
    });
    if (error) throw new Error(`falha ao registrar payment_customer recriado: ${error.message}`);

    const pagamento = await criarCobranca({ customerId: novoCustomer.id, ...params });
    return { pagamento, customerId: novoCustomer.id };
  }
}
