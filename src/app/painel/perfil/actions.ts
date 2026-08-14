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
  serviceRadius: {
    latitude: number;
    longitude: number;
    radiusKm: number;
    locationLabel: string;
    accuracyM: number | null;
    /** Usado apenas para manter compatibilidade com o matching legado por CEP. */
    cep?: string;
  } | null;
};

export type AlvoMidiaPerfil = "avatar" | "banner";

const SPECS = ["instalacao", "manutencao", "remanejamento", "limpeza", "conserto"];

// Prefixo de CEP padrão da praça atendida. Antes era "60" (Fortaleza), sobra de
// outra operação: o profissional que salvasse sem editar ficava fora de toda
// busca, porque o wizard filtra por CIDADE.
const CEP_PREFIX_PADRAO = "01";

function validarRaio(serviceRadius: PerfilInput["serviceRadius"]) {
  if (!serviceRadius) return { ok: true as const, value: null };

  const latitude = Number(serviceRadius.latitude);
  const longitude = Number(serviceRadius.longitude);
  const radiusKm = Math.round(Number(serviceRadius.radiusKm));
  const locationLabel = serviceRadius.locationLabel.trim().slice(0, 120);
  const accuracyM = serviceRadius.accuracyM === null
    ? null
    : Math.round(Number(serviceRadius.accuracyM));

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { ok: false as const, error: "Localização inválida. Atualize sua localização e tente novamente." };
  }
  if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 300) {
    return { ok: false as const, error: "Defina um raio de atendimento entre 1 e 300 km." };
  }
  if (!locationLabel) {
    return { ok: false as const, error: "Informe a cidade usada como base de atendimento." };
  }
  if (accuracyM !== null && (!Number.isFinite(accuracyM) || accuracyM < 0 || accuracyM > 100000)) {
    return { ok: false as const, error: "A precisão da localização recebida é inválida." };
  }

  return {
    ok: true as const,
    value: { latitude, longitude, radiusKm, locationLabel, accuracyM },
  };
}

function urlMidiaValida(url: string, userId: string, alvo: AlvoMidiaPerfil) {
  try {
    const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    const recebida = new URL(url);
    const prefixo = `/storage/v1/object/public/perfil/${userId}/${alvo}-`;
    return recebida.origin === base.origin && recebida.pathname.startsWith(prefixo);
  } catch {
    return false;
  }
}

/**
 * Persiste a referência depois do upload no Storage. A resposta da Data API
 * pode vir sem erro mesmo quando um UPDATE afetou zero linhas; por isso a linha
 * atualizada volta no SELECT e a ausência é tratada como falha real.
 */
export async function salvarMidiaPerfil(alvo: AlvoMidiaPerfil, url: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };
  if (!urlMidiaValida(url, user.id, alvo)) {
    return { ok: false as const, error: "Endereço de imagem inválido." };
  }

  const resultado = alvo === "avatar"
    ? await supabase.from("profiles").update({ avatar_url: url }).eq("id", user.id).select("id").maybeSingle()
    : await supabase.from("professionals").update({ banner_url: url }).eq("id", user.id).select("id").maybeSingle();

  if (resultado.error) return { ok: false as const, error: resultado.error.message };
  if (!resultado.data) {
    return {
      ok: false as const,
      error: alvo === "banner"
        ? "Salve primeiro as informações do perfil profissional."
        : "Não foi possível localizar seu perfil.",
    };
  }

  revalidatePath("/painel/perfil");
  revalidatePath(`/profissional/${user.id}`);
  return { ok: true as const };
}

export async function removerMidiaPerfil(alvo: AlvoMidiaPerfil) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const resultado = alvo === "avatar"
    ? await supabase.from("profiles").update({ avatar_url: null }).eq("id", user.id).select("id").maybeSingle()
    : await supabase.from("professionals").update({ banner_url: null }).eq("id", user.id).select("id").maybeSingle();

  if (resultado.error) return { ok: false as const, error: resultado.error.message };
  if (!resultado.data) return { ok: false as const, error: "Não foi possível localizar seu perfil." };

  revalidatePath("/painel/perfil");
  revalidatePath(`/profissional/${user.id}`);
  return { ok: true as const };
}

export async function salvarPerfil(input: PerfilInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const cidade = input.cidade.trim() || CIDADE;
  const raioValidado = validarRaio(input.serviceRadius);
  if (!raioValidado.ok) return { ok: false as const, error: raioValidado.error };

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

  // 4) localização privada + raio. As coordenadas nunca são gravadas nas
  // tabelas públicas do diretório profissional.
  if (raioValidado.value) {
    const { error: radiusErr } = await supabase.from("professional_service_radius").upsert({
      professional_id: user.id,
      latitude: raioValidado.value.latitude,
      longitude: raioValidado.value.longitude,
      radius_km: raioValidado.value.radiusKm,
      location_label: raioValidado.value.locationLabel,
      accuracy_m: raioValidado.value.accuracyM,
    });
    if (radiusErr) {
      const bancoDesatualizado = radiusErr.code === "PGRST205" || radiusErr.code === "42P01";
      return {
        ok: false as const,
        error: bancoDesatualizado
          ? "A atualização da área por raio ainda não foi aplicada ao banco de dados."
          : `Não foi possível salvar a área de atendimento: ${radiusErr.message}`,
      };
    }
  }

  // 5) compatibilidade: as buscas atuais ainda filtram por prefixo de CEP.
  // O CEP detectado atualiza esse filtro sem voltar a expor o campo antigo.
  const cepDetectado = input.serviceRadius?.cep?.replace(/\D/g, "").slice(0, 5) ?? "";
  const prefix = cepDetectado || input.cepPrefix.replace(/\D/g, "").slice(0, 5) || CEP_PREFIX_PADRAO;
  const { error: areaDeleteErr } = await supabase.from("service_areas").delete().eq("professional_id", user.id);
  if (areaDeleteErr) return { ok: false as const, error: areaDeleteErr.message };
  const { error: areaInsertErr } = await supabase
    .from("service_areas")
    .insert({ professional_id: user.id, cep_prefix: prefix, cidade });
  if (areaInsertErr) return { ok: false as const, error: areaInsertErr.message };

  revalidatePath("/painel");
  revalidatePath("/painel/perfil");
  return { ok: true as const };
}
