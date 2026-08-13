"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CIDADE, ESTADO } from "@/lib/regiao";

export type PerfilInput = {
  tipo: "autonomo" | "empresa";
  razaoSocial: string;
  bio: string;
  cidade: string;
  cepPrefix: string;
  anosExperiencia: number;
  skills: { specialty: string; years: number }[];
  /** Slugs de `skill_tags` — camada de detalhe (equipamentos, serviços, ambientes, credenciais). */
  tags: string[];
};

const SPECS = ["instalacao", "manutencao", "remanejamento", "limpeza", "conserto"];

// Prefixo de CEP padrão da praça atendida. Antes era "60" (Fortaleza), sobra de
// outra operação: o profissional que salvasse sem editar ficava fora de toda
// busca, porque o wizard filtra por CIDADE.
const CEP_PREFIX_PADRAO = "01";

export async function salvarPerfil(input: PerfilInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const cidade = input.cidade.trim() || CIDADE;

  const { error: pErr } = await supabase.from("professionals").upsert({
    id: user.id,
    tipo: input.tipo,
    razao_social: input.tipo === "empresa" ? input.razaoSocial.trim() || null : null,
    bio: input.bio.trim() || null,
    cidade,
    estado: ESTADO,
    anos_experiencia: Math.min(60, Math.max(0, input.anosExperiencia || 0)),
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

  /* 3) tags detalhadas — não carregam histórico nem reputação, então podem ser
     substituídas em bloco. Os slugs são validados contra o catálogo para não
     depender só da FK: erro de slug vira aviso claro, não falha de constraint. */
  const { data: catalogo } = await supabase.from("skill_tags").select("slug").eq("ativo", true);
  const validos = new Set((catalogo ?? []).map((t) => t.slug));
  const tags = [...new Set(input.tags)].filter((t) => validos.has(t));

  await supabase.from("professional_tags").delete().eq("professional_id", user.id);
  if (tags.length) {
    const { error: tErr } = await supabase
      .from("professional_tags")
      .insert(tags.map((tag_slug) => ({ professional_id: user.id, tag_slug })));
    if (tErr) return { ok: false as const, error: tErr.message };
  }

  // 4) área de atendimento
  const prefix = input.cepPrefix.replace(/\D/g, "").slice(0, 5) || CEP_PREFIX_PADRAO;
  await supabase.from("service_areas").delete().eq("professional_id", user.id);
  await supabase.from("service_areas").insert({ professional_id: user.id, cep_prefix: prefix, cidade });

  revalidatePath("/painel");
  revalidatePath("/painel/perfil");
  return { ok: true as const };
}
