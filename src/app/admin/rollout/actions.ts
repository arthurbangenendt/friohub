"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type RolloutState = { ok: boolean; message: string };

export async function configurarRollout(_: RolloutState, formData: FormData): Promise<RolloutState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sua sessão expirou." };
  const rollout = Number(formData.get("rollout"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!Number.isInteger(rollout) || rollout < 0 || rollout > 100) return { ok: false, message: "Use um percentual inteiro entre 0 e 100." };
  const { error } = await supabase.rpc("configurar_feature_flag", {
    p_flag_key: String(formData.get("flagKey") ?? ""),
    p_region_slug: String(formData.get("regionSlug") ?? ""),
    p_enabled: formData.get("enabled") === "on",
    p_rollout_percentage: rollout,
    p_reason: reason,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/rollout"); revalidatePath("/painel");
  return { ok: true, message: "Rollout atualizado e auditado." };
}
