"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CIDADE, REGIAO_SLUG } from "@/lib/regiao";

async function clienteAutenticado() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function solicitarPmoc(input: {
  empresa: string;
  unidade: string;
  cep: string;
  equipamentos: number;
  intervaloMeses: number;
  observacoes: string;
}) {
  const { supabase, user } = await clienteAutenticado();
  if (!user) return { ok: false as const, error: "Faça login para solicitar um PMOC." };
  const { data: liberado } = await supabase.rpc("feature_enabled", {
    p_flag_key: "pmoc", p_region_slug: REGIAO_SLUG, p_subject_id: user.id,
  });
  if (!liberado) return { ok: false as const, error: "PMOC ainda não está disponível nesta região." };

  const equipamentos = Math.trunc(input.equipamentos);
  const intervalo = Math.trunc(input.intervaloMeses);
  if (!Number.isFinite(equipamentos) || !Number.isFinite(intervalo)) {
    return { ok: false as const, error: "Revise a quantidade e a periodicidade." };
  }

  const { data, error } = await supabase.rpc("solicitar_pmoc", {
    p_company_name: input.empresa,
    p_site_name: input.unidade,
    p_cep: input.cep,
    p_cidade: CIDADE,
    p_equipment_count: equipamentos,
    p_interval_months: intervalo,
    p_notes: input.observacoes,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/pmoc");
  revalidatePath("/admin/pmoc");
  return { ok: true as const, id: data };
}

export async function responderPmoc(input: {
  planoId: string;
  aceitar: boolean;
  valorPorVisita?: number;
  primeiraVisita?: string;
}) {
  const { supabase, user } = await clienteAutenticado();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const args = input.aceitar
    ? {
        p_plan_id: input.planoId,
        p_accept: true,
        p_price_per_visit: Number(input.valorPorVisita),
        p_first_due_date: input.primeiraVisita ?? "",
      }
    : { p_plan_id: input.planoId, p_accept: false };
  const { error } = await supabase.rpc("responder_pmoc", args);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/pmoc");
  revalidatePath("/admin/pmoc");
  return { ok: true as const };
}

export async function concluirVisitaPmoc(visitaId: string, observacoes: string) {
  const { supabase, user } = await clienteAutenticado();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { error } = await supabase.rpc("concluir_visita_pmoc", {
    p_visit_id: visitaId,
    p_notes: observacoes,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/pmoc");
  return { ok: true as const };
}

export async function cancelarPmoc(planoId: string, motivo: string) {
  const { supabase, user } = await clienteAutenticado();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { error } = await supabase.rpc("cancelar_pmoc", {
    p_plan_id: planoId,
    p_reason: motivo,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/pmoc");
  revalidatePath("/admin/pmoc");
  return { ok: true as const };
}

export async function atribuirPmoc(planoId: string, profissionalId: string) {
  const { supabase, user } = await clienteAutenticado();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { error } = await supabase.rpc("atribuir_pmoc", {
    p_plan_id: planoId,
    p_professional_id: profissionalId,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/admin/pmoc");
  revalidatePath("/painel/pmoc");
  return { ok: true as const };
}
