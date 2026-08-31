"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { featureHabilitada } from "@/lib/feature-flags";

export async function salvarNota(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  if (!await featureHabilitada(supabase, "ux_portfolio", user.id)) return;

  const { data: permite } = await supabase.rpc("plano_permite", { p_professional_id: user.id, p_feature: "clientes" });
  if (!permite) return;

  const customer_id = String(formData.get("customerId") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  if (!customer_id || !notes) return;

  await supabase.from("professional_client_notes").upsert(
    { professional_id: user.id, customer_id, notes },
    { onConflict: "professional_id,customer_id" },
  );
  revalidatePath("/painel/clientes");
}
