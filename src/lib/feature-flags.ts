import "server-only";
import { REGIAO_SLUG } from "@/lib/regiao";
import type { createClient } from "@/lib/supabase/server";

export type UxFeature =
  | "ux_pipeline"
  | "ux_execution"
  | "ux_portfolio"
  | "ux_growth"
  /* Conversas pelo Chatwoot (20260815095000). Governa o caminho de ESCRITA da
     mensagem e o que a tela de atendimento mostra. Não governa a entrada: se o
     Chatwoot já está entregando evento, espelhar é sempre certo — desligar a
     flag no meio de uma conversa não pode fazer mensagem sumir. */
  | "chatwoot_messaging"
  /* Assistente de IA do profissional (20260828100000). Kill switch
     independente do gate de plano: `plano_permite('assistente')` decide quem
     PODE usar (só Master); esta flag decide se a feature está no ar agora. */
  | "assistente_ia";
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function featureHabilitada(client: SupabaseServerClient, flag: UxFeature, subjectId: string) {
  const { data, error } = await client.rpc("feature_enabled", {
    p_flag_key: flag,
    p_region_slug: REGIAO_SLUG,
    p_subject_id: subjectId,
  });
  // Falha fechada: uma indisponibilidade de configuração não deve publicar uma
  // experiência fora do rollout definido.
  return !error && data === true;
}
