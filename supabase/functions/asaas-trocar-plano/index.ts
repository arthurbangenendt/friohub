/* Profissional já assinante troca de plano — upgrade ou downgrade.
 *
 * Autorização: JWT do usuário, mesmo padrão de `asaas-assinar`.
 *
 * Upgrade: cobra a diferença proporcional aos dias restantes do ciclo agora
 * mesmo (`preparar_upgrade_assinatura`), devolve o checkout do Asaas — o
 * plano só troca de fato quando essa cobrança liquidar (processar_evento_gateway).
 *
 * Downgrade: não cobra nada agora. Só registra a intenção
 * (`solicitar_downgrade_assinatura`) — aplicar no vencimento é
 * responsabilidade do worker de renovação, que ainda não existe. A resposta
 * deixa isso explícito para a tela não prometer o que o backend não garante.
 */

import { servico, json } from "../_shared/supabase.ts";
import { criarCobrancaComRecuperacao, AsaasError } from "../_shared/asaas.ts";

type Corpo = { plano_slug?: string };

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
  if (!planoSlug) return json({ error: "Informe o plano." }, 400);

  const db = servico();

  const { data: auth, error: erroAuth } = await db.auth.getUser(jwt);
  const userId = auth?.user?.id;
  if (erroAuth || !userId) return json({ error: "Sessão inválida." }, 401);

  const { data: planos, error: erroPlano } = await db.rpc("obter_plano_publico", { p_slug: planoSlug });
  const plano = Array.isArray(planos) ? planos[0] : null;
  if (erroPlano || !plano) return json({ error: "Plano indisponível." }, 404);

  const { data: upgradeChargeId, error: erroUpgrade } = await db.rpc("preparar_upgrade_assinatura", {
    p_professional_id: userId,
    p_novo_plano_id: plano.id,
  });

  if (!erroUpgrade && upgradeChargeId) {
    try {
      const { data: gatewayCustomerId } = await db.rpc("obter_payment_customer", {
        p_user_id: userId,
        p_gateway: "asaas",
      });
      if (!gatewayCustomerId) {
        return json({ error: "Pagador não cadastrado no gateway. Contate o suporte." }, 500);
      }

      const { data: chargesExistentes } = await db.rpc("obter_checkout_cobranca", { p_charge_id: upgradeChargeId });
      const chargeExistente = Array.isArray(chargesExistentes) ? chargesExistentes[0] : null;
      if (chargeExistente?.checkout_url) {
        return json({ ok: true, tipo: "upgrade", checkout_url: chargeExistente.checkout_url });
      }

      const [{ data: nomePerfil }, { data: cpfCnpj }, { data: authUser }] = await Promise.all([
        db.rpc("obter_nome_perfil", { p_user_id: userId }),
        db.rpc("obter_cpf_cnpj_professional", { p_user_id: userId }),
        db.auth.admin.getUserById(userId),
      ]);

      const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { pagamento } = await criarCobrancaComRecuperacao(db, {
        userId,
        customerIdAtual: gatewayCustomerId as string,
        nome: (nomePerfil as string | null) ?? "Profissional FrioHub",
        email: authUser?.user?.email ?? "",
        cpfCnpj: (cpfCnpj as string | null) ?? "",
        billingType: "UNDEFINED",
        value: chargeExistente?.amount ?? plano.preco_mensal,
        dueDate,
        description: `FrioHub — Upgrade para o plano ${plano.nome}`,
        externalReference: upgradeChargeId,
      });

      const { error: erroVincular } = await db.rpc("vincular_cobranca_gateway", {
        p_charge_id: upgradeChargeId,
        p_gateway_payment_id: pagamento.id,
        p_checkout_url: pagamento.invoiceUrl,
        p_due_date: pagamento.dueDate,
      });
      if (erroVincular) {
        console.error(`falha ao vincular cobrança de upgrade: ${erroVincular.message}`);
        return json({ error: "Cobrança criada no gateway, mas falhou ao vincular. Contate o suporte." }, 500);
      }

      return json({ ok: true, tipo: "upgrade", checkout_url: pagamento.invoiceUrl });
    } catch (erro) {
      if (erro instanceof AsaasError) {
        console.error(`Asaas recusou upgrade: ${erro.status} ${erro.corpo}`);
        return json({ error: "O gateway de pagamento recusou a cobrança do upgrade." }, 502);
      }
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      console.error(`falha ao processar upgrade: ${mensagem}`);
      return json({ error: "Não foi possível processar o upgrade agora." }, 500);
    }
  }

  // Não é upgrade (preparar_upgrade_assinatura recusou por não ser mais caro)
  // — tenta como downgrade.
  const { error: erroDowngrade } = await db.rpc("solicitar_downgrade_assinatura", {
    p_professional_id: userId,
    p_novo_plano_id: plano.id,
  });

  if (erroDowngrade) {
    // Nem upgrade nem downgrade válido — devolve a mensagem original do
    // upgrade, que é a mais específica (ex.: sem assinatura ativa).
    return json({ error: erroUpgrade?.message ?? erroDowngrade.message }, 400);
  }

  return json({
    ok: true,
    tipo: "downgrade",
    aviso: "Downgrade agendado para o próximo vencimento — você continua no plano atual até lá.",
  });
});
