"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/* PMOC originado pelo profissional.
 *
 * Toda a validação de verdade mora no banco (`propor_pmoc_profissional` e
 * `responder_proposta_pmoc`, em 20260813210000): profissional verificado,
 * histórico de serviço com aquele cliente, faixas de valor e data. Aqui só
 * repassamos — checagem no front é conveniência, não segurança, e duplicar
 * regra em dois lugares garante que uma das duas vai ficar velha. */

export type NovaProposta = {
  clientId: string;
  companyName: string;
  siteName: string;
  cep: string;
  cidade: string;
  equipmentCount: number;
  intervalMonths: number;
  pricePerVisit: number;
  firstDueDate: string;
  notes?: string;
};

export type Resultado = { ok: true } | { ok: false; erro: string };

export async function proporPmoc(input: NovaProposta): Promise<Resultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, erro: "Não autenticado." };

  const { error } = await supabase.rpc("propor_pmoc_profissional", {
    p_client_id: input.clientId,
    p_company_name: input.companyName,
    p_site_name: input.siteName,
    p_cep: input.cep.replace(/\D/g, ""),
    p_cidade: input.cidade,
    p_equipment_count: input.equipmentCount,
    p_interval_months: input.intervalMonths,
    p_price_per_visit: input.pricePerVisit,
    p_first_due_date: input.firstDueDate,
    p_notes: input.notes?.trim() || undefined,
  });

  // As mensagens do RPC já são escritas para o usuário final.
  if (error) return { ok: false, erro: error.message };

  revalidatePath("/painel/pmoc");
  return { ok: true };
}

export async function responderProposta(
  planId: string,
  aceitar: boolean,
  motivo?: string,
): Promise<Resultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, erro: "Não autenticado." };

  const { error } = await supabase.rpc("responder_proposta_pmoc", {
    p_plan_id: planId,
    p_accept: aceitar,
    p_reason: motivo?.trim() || undefined,
  });
  if (error) return { ok: false, erro: error.message };

  revalidatePath("/painel/pmoc");
  revalidatePath("/painel/pmoc/propostas");
  return { ok: true };
}
