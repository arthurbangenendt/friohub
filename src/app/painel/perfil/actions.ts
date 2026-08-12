"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type PerfilInput = {
  tipo: "autonomo" | "empresa";
  razaoSocial: string;
  bio: string;
  cidade: string;
  cepPrefix: string;
  skills: { specialty: string; years: number }[];
};

const SPECS = ["instalacao", "manutencao", "remanejamento", "limpeza", "conserto"];

export async function salvarPerfil(input: PerfilInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const cidade = input.cidade.trim() || "São Paulo";

  // Não rebaixa quem já é verificado; novos/editados entram em análise (RISCO 4).
  const { data: atual } = await supabase
    .from("professionals").select("verification_status").eq("id", user.id).maybeSingle();
  const novoStatus = atual?.verification_status === "verificado" ? "verificado" : "em_analise";

  const { error: pErr } = await supabase.from("professionals").upsert({
    id: user.id,
    tipo: input.tipo,
    razao_social: input.tipo === "empresa" ? input.razaoSocial.trim() || null : null,
    bio: input.bio.trim() || null,
    cidade,
    estado: "SP",
    verification_status: novoStatus,
  });
  if (pErr) return { ok: false as const, error: pErr.message };

  // 2) skills — preserva rating/histórico das existentes; remove as desmarcadas
  const desejadas = input.skills.filter((s) => SPECS.includes(s.specialty));
  const desejadasSet = new Set(desejadas.map((s) => s.specialty));

  const { data: atuais } = await supabase
    .from("professional_skills")
    .select("specialty")
    .eq("professional_id", user.id);

  const remover = (atuais ?? []).map((a) => a.specialty).filter((s) => !desejadasSet.has(s));
  if (remover.length) {
    await supabase.from("professional_skills").delete().eq("professional_id", user.id).in("specialty", remover);
  }

  for (const s of desejadas) {
    // só grava specialty + anos: rating_avg/jobs_completed mantêm o valor existente
    await supabase.from("professional_skills").upsert(
      { professional_id: user.id, specialty: s.specialty, years_experience: Math.max(0, s.years || 0) },
      { onConflict: "professional_id,specialty" },
    );
  }

  // 3) área de atendimento
  const prefix = input.cepPrefix.replace(/\D/g, "").slice(0, 5) || "60";
  await supabase.from("service_areas").delete().eq("professional_id", user.id);
  await supabase.from("service_areas").insert({ professional_id: user.id, cep_prefix: prefix, cidade });

  revalidatePath("/painel");
  revalidatePath("/painel/perfil");
  return { ok: true as const };
}
