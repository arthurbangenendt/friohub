/* Worker de sincronização de PII pós-handoff.
 *
 * Acordado pelo `pg_cron` a cada 5 minutos (`disparar_worker_chatwoot_pii`,
 * migration 20260831100000). `pii_liberado_para_chatwoot()` e
 * `marcar_pii_sincronizado_chatwoot()` existem desde 20260815090000, mas até
 * aqui nenhum código as chamava — o telefone/e-mail nunca chegava ao contato
 * do Chatwoot mesmo com handoff liberado e duplo consentimento.
 *
 * O recorte de candidatas fica no banco (`conversas_pendentes_sync_pii`), não
 * aqui — mesma lição já aplicada ao dispatch de WhatsApp: é lá que dá para
 * revisar e testar.
 */

import { servico, json } from "../_shared/supabase.ts";
import { chatwoot } from "../_shared/chatwoot.ts";
import { identidade } from "../_shared/provisionamento.ts";

const LOTE = 20;

type PiiLiberado = { profile_id: string; telefone: string | null; email: string | null };

Deno.serve(async () => {
  const db = servico();

  const { data: conversas, error } = await db.rpc("conversas_pendentes_sync_pii", { p_limit: LOTE });
  if (error) {
    console.error(`falha ao listar candidatas: ${error.message}`);
    return json({ error: "Não foi possível listar conversas pendentes." }, 500);
  }

  const conversaIds = (conversas ?? []) as string[];
  let sincronizadas = 0;
  let falhas = 0;

  for (const conversaId of conversaIds) {
    try {
      sincronizadas += await sincronizar(db, conversaId);
    } catch (erro) {
      console.error(`sync PII da conversa ${conversaId}: ${erro instanceof Error ? erro.message : String(erro)}`);
      falhas++;
    }
  }

  return json({ ok: true, conversas: conversaIds.length, sincronizadas, falhas });
});

async function sincronizar(db: ReturnType<typeof servico>, conversaId: string): Promise<number> {
  const { data, error } = await db.rpc("pii_liberado_para_chatwoot", { p_conversation_id: conversaId });
  if (error) throw new Error(`pii_liberado_para_chatwoot: ${error.message}`);

  const liberados = (data ?? []) as PiiLiberado[];
  const sincronizados: string[] = [];

  for (const linha of liberados) {
    if (!linha.telefone && !linha.email) continue;

    const id = await identidade(db, linha.profile_id);
    if (!id?.chatwoot_contact_id) {
      /* Sem contato provisionado ainda não há o que atualizar — a próxima
         mensagem provisiona via garantirContato() e um sweep futuro sincroniza. */
      continue;
    }

    await chatwoot("PUT", `/contacts/${id.chatwoot_contact_id}`, {
      phone_number: linha.telefone || undefined,
      email: linha.email || undefined,
    });
    sincronizados.push(linha.profile_id);
  }

  if (sincronizados.length === 0) return 0;

  const { data: marcados, error: erroMarcar } = await db.rpc("marcar_pii_sincronizado_chatwoot", {
    p_profile_ids: sincronizados,
  });
  if (erroMarcar) throw new Error(`marcar_pii_sincronizado_chatwoot: ${erroMarcar.message}`);
  return (marcados as number | null) ?? 0;
}
