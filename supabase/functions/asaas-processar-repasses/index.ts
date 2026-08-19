/* Processa os repasses automáticos que já passaram da janela de contenção.
 *
 * Acordado por `disparar_processador_repasses()` via pg_net a cada 15 minutos
 * (20260819160000_repasse_asaas_transfer.sql) — não recebe JWT de usuário,
 * só a chave guardada no Vault (`repasses_worker_key`).
 *
 * RISCO DE PAGAMENTO DUPLICADO: `listar_repasses_prontos` já RESERVOU cada
 * linha (pending_creation -> pending) antes desta função rodar. Uma falha
 * aqui NUNCA deve devolver a linha pra fila — só `marcar_repasse_falho`,
 * que a deixa parada para investigação manual. Repasse não tem cobrança
 * amarrada como as de `payment_charges`: uma vez que o Asaas aceitou o POST,
 * o dinheiro já saiu de verdade.
 */

import { servico, json } from "../_shared/supabase.ts";
import { criarTransferencia, AsaasError } from "../_shared/asaas.ts";

const WORKER_KEY = Deno.env.get("REPASSES_WORKER_KEY") ?? "";

const TIPO_PIX: Record<string, "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP"> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "EMAIL",
  telefone: "PHONE",
  aleatoria: "EVP",
};

type RepasseFila = {
  id: string;
  job_id: string;
  amount: number;
  pix_key: string;
  pix_key_type: string;
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

  const { data: fila, error: erroFila } = await db.rpc("listar_repasses_prontos", { p_limit: 20 });
  if (erroFila) {
    console.error(`asaas-processar-repasses: falha ao listar fila: ${erroFila.message}`);
    return json({ error: erroFila.message }, 500);
  }

  const repasses = (fila ?? []) as RepasseFila[];
  let processados = 0;
  let falhas = 0;

  for (const repasse of repasses) {
    const tipoChave = TIPO_PIX[repasse.pix_key_type];
    if (!tipoChave) {
      await db.rpc("marcar_repasse_falho", {
        p_transfer_id: repasse.id,
        p_erro: `Tipo de chave PIX desconhecido: ${repasse.pix_key_type}`,
      });
      falhas++;
      continue;
    }

    try {
      const transferencia = await criarTransferencia({
        value: repasse.amount,
        pixAddressKey: repasse.pix_key,
        pixAddressKeyType: tipoChave,
        description: `FrioHub — repasse do serviço ${repasse.job_id}`,
        externalReference: repasse.id,
      });

      const { error: erroVincular } = await db.rpc("vincular_transferencia_gateway", {
        p_transfer_id: repasse.id,
        p_gateway_transfer_id: transferencia.id,
        p_status: transferencia.status,
      });
      if (erroVincular) {
        /* Caso mais delicado: o Asaas ACEITOU a transferência (dinheiro já
           saiu) mas não conseguimos gravar isso localmente. Não tenta de
           novo — geraria uma segunda transferência real. Fica como falha
           para reconciliação manual usando o id retornado, logado abaixo. */
        console.error(
          `asaas-processar-repasses: transferência ${transferencia.id} foi criada no Asaas mas falhou ao vincular (repasse ${repasse.id}): ${erroVincular.message}`,
        );
        falhas++;
        continue;
      }
      processados++;
    } catch (erro) {
      const mensagem = erro instanceof AsaasError
        ? `Asaas recusou: ${erro.status} ${erro.corpo}`
        : erro instanceof Error ? erro.message : String(erro);
      console.error(`asaas-processar-repasses: falha no repasse ${repasse.id}: ${mensagem}`);
      await db.rpc("marcar_repasse_falho", { p_transfer_id: repasse.id, p_erro: mensagem });
      falhas++;
    }
  }

  return json({ ok: true, total: repasses.length, processados, falhas });
});
