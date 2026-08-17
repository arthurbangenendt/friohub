/* Provisionamento explícito de um perfil no Chatwoot.
 *
 * O caminho normal é preguiçoso: `garantirConversa` cria contato e usuário na
 * primeira mensagem. Esta função existe para os dois casos em que esperar a
 * primeira mensagem não serve:
 *
 *   · backfill dos profissionais que já existem no banco, para que apareçam
 *     como possíveis `assignee` antes de qualquer conversa;
 *   · reprocessar quem ficou sem `chatwoot_user_id` porque o vínculo do
 *     PlatformApp com a conta ainda não existia (Fase 0).
 *
 * Só service_role chama — não há caminho a partir de sessão de usuário.
 */

import { servico, json } from "../_shared/supabase.ts";
import { garantirContato, garantirUsuario } from "../_shared/provisionamento.ts";

const LOTE_MAXIMO = 50;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método não suportado." }, 405);

  let corpo: { profile_id?: string; backfill_profissionais?: boolean; limite?: number };
  try {
    corpo = await req.json();
  } catch {
    corpo = {};
  }

  const db = servico();

  if (corpo.profile_id) {
    try {
      const resultado = await provisionar(db, corpo.profile_id);
      return json({ ok: true, ...resultado });
    } catch (erro) {
      return json({ error: erro instanceof Error ? erro.message : String(erro) }, 500);
    }
  }

  if (!corpo.backfill_profissionais) {
    return json({ error: "Informe profile_id ou backfill_profissionais." }, 400);
  }

  const limite = Math.min(Math.max(1, corpo.limite ?? LOTE_MAXIMO), LOTE_MAXIMO);

  /* Quem ainda não tem usuário no Chatwoot. Duas consultas, não um embed:
     `chatwoot_identities.profile_id` referencia `profiles(id)`, não
     `professionals(id)` — mesmo os dois compartilhando o mesmo espaço de PK,
     não há FK direta entre as duas tabelas para o PostgREST inferir o embed
     (`professionals!left(chatwoot_identities...)` falha com "Could not find a
     relationship"). O anti-join fica em memória, sobre no máximo LOTE_MAXIMO
     ids de cada lado. */
  const { data: profissionais, error: erroProfissionais } = await db
    .from("professionals")
    .select("id")
    .limit(limite * 4);
  if (erroProfissionais) return json({ error: `consulta falhou: ${erroProfissionais.message}` }, 500);

  const idsProfissionais = (profissionais ?? []).map((p: { id: string }) => p.id);
  const { data: identidades, error: erroIdentidades } = idsProfissionais.length
    ? await db
        .from("chatwoot_identities")
        .select("profile_id, chatwoot_user_id")
        .in("profile_id", idsProfissionais)
        .not("chatwoot_user_id", "is", null)
    : { data: [] as Array<{ profile_id: string }>, error: null };
  if (erroIdentidades) return json({ error: `consulta falhou: ${erroIdentidades.message}` }, 500);

  const jaProvisionados = new Set((identidades ?? []).map((i: { profile_id: string }) => i.profile_id));
  const pendentes = idsProfissionais
    .filter((id: string) => !jaProvisionados.has(id))
    .slice(0, limite)
    .map((id: string) => ({ id }));
  const resultados: Array<Record<string, unknown>> = [];

  for (const p of pendentes) {
    try {
      resultados.push({ profile_id: p.id, ...(await provisionar(db, p.id)) });
    } catch (erro) {
      /* Um perfil sem e-mail em auth.users, ou sem o vínculo do PlatformApp,
         não pode derrubar o lote inteiro. */
      resultados.push({
        profile_id: p.id,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }

  return json({ ok: true, processados: resultados.length, resultados });
});

async function provisionar(db: ReturnType<typeof servico>, profileId: string) {
  const contactId = await garantirContato(db, profileId);

  const { data } = await db.from("profiles").select("role").eq("id", profileId).maybeSingle();
  const role = (data as { role: string } | null)?.role;

  /* Só profissional vira usuário do Chatwoot. Cliente e distribuidora são
     contatos — atribuir conversa a eles não faria sentido. */
  if (role !== "profissional") {
    return { chatwoot_contact_id: contactId, chatwoot_user_id: null };
  }

  const userId = await garantirUsuario(db, profileId);
  return { chatwoot_contact_id: contactId, chatwoot_user_id: userId };
}
