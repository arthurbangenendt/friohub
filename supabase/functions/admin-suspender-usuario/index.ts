/* Suspende ou reativa o LOGIN de um cliente — ban nativo do Supabase Auth
 * (`ban_duration`), não mexe em job/orçamento/pedido em aberto. Isso fica
 * pra intervenção manual do admin, caso a caso (decisão do time: suspensão
 * v1 é só bloquear login, nada automático em cima disso).
 *
 * v1 só cobre `role = 'cliente'`: suspender profissional/distribuidora/admin
 * tem efeito em terceiros (job em andamento, repasse pendente) e é decisão
 * de produto separada, fora deste escopo.
 *
 * Autorização: JWT do admin, checado aqui (mesmo padrão de
 * asaas-resolver-disputa) — só `service_role` alcança `auth.admin.*`.
 */

import { servico, json } from "../_shared/supabase.ts";

type Corpo = { user_id?: string; acao?: "suspender" | "reativar"; motivo?: string };

// GoTrue não aceita "para sempre" direto — ~100 anos é o vocabulário local de "indefinido".
const DURACAO_SUSPENSAO = "876000h";

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

  const userId = typeof corpo.user_id === "string" ? corpo.user_id : "";
  const acao = corpo.acao;
  const motivo = typeof corpo.motivo === "string" ? corpo.motivo.trim() : "";
  if (!userId || (acao !== "suspender" && acao !== "reativar")) {
    return json({ error: "Informe o usuário e a ação (suspender ou reativar)." }, 400);
  }
  if (motivo.length < 5 || motivo.length > 500) {
    return json({ error: "Informe uma justificativa entre 5 e 500 caracteres." }, 400);
  }

  const db = servico();

  const { data: auth, error: erroAuth } = await db.auth.getUser(jwt);
  const adminId = auth?.user?.id;
  if (erroAuth || !adminId) return json({ error: "Sessão inválida." }, 401);

  const { data: perfilAdmin } = await db.from("profiles").select("role").eq("id", adminId).maybeSingle();
  if (perfilAdmin?.role !== "admin") return json({ error: "Apenas administradores podem suspender contas." }, 403);

  if (userId === adminId) return json({ error: "Você não pode suspender a própria conta." }, 400);

  const { data: perfilAlvo } = await db.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (!perfilAlvo) return json({ error: "Usuário não encontrado." }, 404);
  if (perfilAlvo.role !== "cliente") {
    return json({
      error: "Esta ação só suspende contas de cliente — profissional, distribuidora e admin têm efeito em terceiros e exigem decisão separada.",
    }, 400);
  }

  const { error: erroBan } = await db.auth.admin.updateUserById(userId, {
    ban_duration: acao === "suspender" ? DURACAO_SUSPENSAO : "none",
  });
  if (erroBan) return json({ error: erroBan.message }, 500);

  const { error: erroLog } = await db.from("admin_audit_log").insert({
    actor_id: adminId,
    action: acao === "suspender" ? "user_suspended" : "user_reactivated",
    entity_type: "profile",
    entity_id: userId,
    old_values: { suspenso: acao === "reativar" },
    new_values: { suspenso: acao === "suspender" },
    reason: motivo,
  });
  if (erroLog) {
    console.error(`admin-suspender-usuario: ban aplicado mas falhou ao auditar (user ${userId}): ${erroLog.message}`);
  }

  return json({ ok: true });
});
