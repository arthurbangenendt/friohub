"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { JobType } from "@/app/solicitar/tipos";
import { MAX_DESTINATARIOS } from "./config";

/* Orçamentos (RFQ).
 *
 * Este é o caminho padrão de contratação: o cliente descreve uma vez e envia
 * para vários profissionais; cada um responde com preço fechado ou proposta de
 * visita técnica; o cliente aceita uma, e é o aceite que cria o job com preço e
 * a comissão da plataforma. Ver 20260812240000_orcamentos.sql.
 */

export type NovoPedido = {
  jobType: JobType;
  cep: string;
  cidade: string;
  bairro?: string;
  quantidade: number;
  urgencia?: "sem_pressa" | "proximos_dias" | "urgente";
  descricao?: string;
  detalhes: Record<string, string>;
  produtoId?: string | null;
  btuRecomendado?: number | null;
  profissionaisIds: string[];
  fotos?: string[];
  latitude?: number | null;
  longitude?: number | null;
};

export async function criarPedidoOrcamento(input: NovoPedido) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Faça login para pedir orçamento." };

  const destinatarios = [...new Set(input.profissionaisIds)];
  if (destinatarios.length === 0 || destinatarios.length > MAX_DESTINATARIOS) {
    return { ok: false as const, error: `Escolha entre um e ${MAX_DESTINATARIOS} profissionais.` };
  }

  const fotos = [...new Set(input.fotos ?? [])];
  if (fotos.length > 6 || fotos.some((path) => !path.startsWith(`${user.id}/`))) {
    return { ok: false as const, error: "Uma ou mais fotos são inválidas." };
  }

  const recebeuCoordenadas = input.latitude !== null && input.latitude !== undefined
    || input.longitude !== null && input.longitude !== undefined;
  const coordenadasValidas = Number.isFinite(input.latitude)
    && Number.isFinite(input.longitude)
    && Number(input.latitude) >= -90
    && Number(input.latitude) <= 90
    && Number(input.longitude) >= -180
    && Number(input.longitude) <= 180;
  if (recebeuCoordenadas && !coordenadasValidas) {
    return { ok: false as const, error: "Não foi possível validar a localização do serviço." };
  }

  const { data: pedidoId, error } = await supabase.rpc("criar_pedido_orcamento", {
    p_job_type: input.jobType,
    p_cep: input.cep,
    p_cidade: input.cidade.trim(),
    p_bairro: input.bairro ?? "",
    p_quantidade: input.quantidade,
    p_urgencia: input.urgencia ?? "",
    p_descricao: input.descricao ?? "",
    p_detalhes: input.detalhes ?? {},
    p_produto_id: input.produtoId ?? "",
    p_btu_recomendado: input.btuRecomendado ?? 0,
    p_profissionais_ids: destinatarios,
    p_fotos: fotos,
    p_latitude: coordenadasValidas ? Number(input.latitude) : undefined,
    p_longitude: coordenadasValidas ? Number(input.longitude) : undefined,
  });

  if (error || !pedidoId) {
    // Se a transação falhar, os uploads ainda não vinculados são removidos.
    if (fotos.length) await supabase.storage.from("orcamentos").remove(fotos);
    const mensagem = error?.message === "Um ou mais profissionais não atendem esta localização ou serviço."
      ? "A área de atendimento de um profissional mudou. Volte e escolha novamente quem atende o local do serviço."
      : error?.message;
    return { ok: false as const, error: mensagem ?? "Não foi possível criar o pedido." };
  }

  revalidatePath("/painel/orcamentos");
  return { ok: true as const, pedidoId, enviados: destinatarios.length };
}

export type PropostaInput = {
  pedidoId: string;
  tipo: "preco_fechado" | "visita_tecnica";
  valorMaoObra: number;
  valorMateriais: number;
  valorVisita: number;
  visitaAbatida: boolean;
  inclui?: string;
  naoInclui?: string;
  prazoExecucao?: string;
  garantiaDias: number;
  validadeAte: string;
  observacoes?: string;
};

export async function enviarProposta(input: PropostaInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const naoNeg = (n: number) => Math.max(0, Number.isFinite(n) ? n : 0);
  const maoObra = naoNeg(input.valorMaoObra);
  const materiais = naoNeg(input.valorMateriais);
  const visita = naoNeg(input.valorVisita);

  // Mesma regra do CHECK no banco, verificada aqui para virar mensagem legível.
  if (input.tipo === "preco_fechado" && maoObra + materiais <= 0) {
    return { ok: false as const, error: "Informe o valor da mão de obra ou dos materiais." };
  }

  const { error } = await supabase.from("quotes").insert({
    quote_request_id: input.pedidoId,
    professional_id: user.id,
    tipo: input.tipo,
    valor_mao_obra: maoObra,
    valor_materiais: materiais,
    valor_visita: visita,
    visita_abatida: input.visitaAbatida,
    inclui: input.inclui?.trim() || null,
    nao_inclui: input.naoInclui?.trim() || null,
    prazo_execucao: input.prazoExecucao?.trim() || null,
    garantia_dias: Math.max(0, input.garantiaDias || 0),
    validade_ate: input.validadeAte,
    observacoes: input.observacoes?.trim() || null,
  });

  if (error) {
    if (error.code === "23505") return { ok: false as const, error: "Você já enviou uma proposta para este pedido." };
    if (error.code === "42501") return { ok: false as const, error: "Este pedido não está mais aberto para propostas." };
    return { ok: false as const, error: error.message };
  }

  revalidatePath(`/painel/orcamentos/${input.pedidoId}`);
  revalidatePath("/painel/orcamentos");
  return { ok: true as const };
}

/** Aceita a proposta: cria o job com preço e a order com comissão, recusa as
 *  concorrentes e fecha o pedido — tudo num passo, dentro do banco.
 *
 *  É aqui que o questionário técnico do local é respondido. No pedido inicial ele
 *  não é cobrado do cliente: pedir metragem de linha frigorígena e tipo de parede
 *  antes de existir alguém interessado é atrito puro. Na hora de fechar, o
 *  esforço faz sentido — e o profissional precisa desses dados para executar. */
export async function aceitarProposta(
  quoteId: string,
  endereco: string,
  detalhes: Record<string, string>,
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const end = endereco.trim();
  if (end.length < 5) return { ok: false as const, error: "Informe o endereço completo do serviço." };

  const { data, error } = await supabase.rpc("aceitar_quote", {
    p_quote_id: quoteId,
    p_endereco: end,
    p_detalhes: detalhes,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/orcamentos");
  revalidatePath("/painel");
  return { ok: true as const, jobId: data as string };
}

/** O profissional declina o pedido. Sinaliza ao cliente sem deixá-lo esperando
 *  uma resposta que não vem. */
export async function recusarPedido(pedidoId: string, motivo: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("recusar_pedido_orcamento", {
    p_quote_request_id: pedidoId,
    p_reason: motivo,
  });

  if (error) return { ok: false as const, error: error.message };

  revalidatePath(`/painel/orcamentos/${pedidoId}`);
  revalidatePath("/painel/orcamentos");
  return { ok: true as const };
}

/** Cliente desiste do pedido antes de aceitar qualquer proposta. */
export async function cancelarPedido(pedidoId: string, motivo: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancelar_pedido_orcamento", {
    p_quote_request_id: pedidoId,
    p_reason: motivo,
  });

  if (error) return { ok: false as const, error: error.message };
  revalidatePath(`/painel/orcamentos/${pedidoId}`);
  revalidatePath("/painel/orcamentos");
  return { ok: true as const };
}
