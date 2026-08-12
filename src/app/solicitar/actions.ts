"use server";

import { createClient } from "@/lib/supabase/server";
import { precoInstalacao, TAXA_COMISSAO } from "@/lib/pricing";
import { CIDADE } from "@/lib/regiao";

export type JobType =
  | "instalacao_com_equipamento"
  | "manutencao"
  | "remanejamento"
  | "limpeza"
  | "conserto";

export type CriarSolicitacaoInput = {
  jobType: JobType;
  cep: string;
  endereco?: string;
  ambiente?: string;
  areaM2?: number;
  numPessoas?: number;
  insolacaoAlta?: boolean;
  andarOuTelhado?: boolean;
  btuRecomendado?: number;
  produtoId?: string | null;
  profissionalId: string;
  descricao?: string;
};

export async function criarSolicitacao(input: CriarSolicitacaoInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, error: "Faça login para solicitar." };

  const hasEquipment = input.jobType === "instalacao_com_equipamento";

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert({
      cliente_id: user.id,
      job_type: input.jobType,
      has_equipment: hasEquipment,
      cep: input.cep,
      endereco: input.endereco ?? null,
      cidade: CIDADE,
      area_m2: input.areaM2 ?? null,
      ambiente: input.ambiente ?? null,
      andar_ou_telhado: input.andarOuTelhado ?? null,
      insolacao_alta: input.insolacaoAlta ?? null,
      num_pessoas: input.numPessoas ?? null,
      btu_recomendado: input.btuRecomendado ?? null,
      produto_id: hasEquipment ? input.produtoId ?? null : null,
      profissional_id: input.profissionalId,
      status: "aguardando_profissional",
      descricao: input.descricao ?? null,
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    return { ok: false as const, error: jobErr?.message ?? "Erro ao criar solicitação." };
  }

  // Job com equipamento -> cria a ordem com preços, margem e comissão
  if (hasEquipment && input.produtoId) {
    const { data: prod } = await supabase
      .from("products")
      .select("preco_venda, custo")
      .eq("id", input.produtoId)
      .single();

    const precoProduto = Number(prod?.preco_venda ?? 0);
    const margem = precoProduto - Number(prod?.custo ?? 0);
    const precoServico = precoInstalacao(input.btuRecomendado ?? 0);
    const comissao = Math.round(precoServico * TAXA_COMISSAO * 100) / 100;

    await supabase.from("orders").insert({
      job_id: job.id,
      preco_produto: precoProduto,
      preco_servico: precoServico,
      comissao_servico: comissao,
      margem_produto: margem,
      total: precoProduto + precoServico,
      payment_status: "pendente",
    });
  }

  return { ok: true as const, jobId: job.id };
}
