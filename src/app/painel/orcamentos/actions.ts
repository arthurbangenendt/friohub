"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CIDADE } from "@/lib/regiao";
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
  bairro?: string;
  quantidade: number;
  urgencia?: "sem_pressa" | "proximos_dias" | "urgente";
  descricao?: string;
  detalhes: Record<string, string>;
  produtoId?: string | null;
  btuRecomendado?: number | null;
  profissionaisIds: string[];
  fotos?: string[];
};

export async function criarPedidoOrcamento(input: NovoPedido) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Faça login para pedir orçamento." };

  const destinatarios = [...new Set(input.profissionaisIds)].slice(0, MAX_DESTINATARIOS);
  if (destinatarios.length === 0) {
    return { ok: false as const, error: "Escolha pelo menos um profissional." };
  }

  const { data: pedido, error } = await supabase
    .from("quote_requests")
    .insert({
      cliente_id: user.id,
      job_type: input.jobType,
      cep: input.cep,
      cidade: CIDADE,
      bairro: input.bairro ?? null,
      quantidade: Math.min(100, Math.max(1, input.quantidade || 1)),
      urgencia: input.urgencia ?? null,
      descricao: input.descricao ?? null,
      detalhes: input.detalhes ?? {},
      produto_id: input.produtoId ?? null,
      btu_recomendado: input.btuRecomendado ?? null,
    })
    .select("id")
    .single();

  if (error || !pedido) {
    return { ok: false as const, error: error?.message ?? "Não foi possível criar o pedido." };
  }

  const { error: tErr } = await supabase
    .from("quote_request_targets")
    .insert(destinatarios.map((professional_id) => ({ quote_request_id: pedido.id, professional_id })));

  if (tErr) {
    /* Pedido sem destinatário nenhum não serve para nada e ficaria órfão no
       painel. Desfaz para o cliente poder tentar de novo com estado limpo. */
    await supabase.from("quote_requests").delete().eq("id", pedido.id);
    return { ok: false as const, error: tErr.message };
  }

  if (input.fotos?.length) {
    await supabase
      .from("quote_request_photos")
      .insert(input.fotos.map((url) => ({ quote_request_id: pedido.id, url })));
  }

  revalidatePath("/painel/orcamentos");
  return { ok: true as const, pedidoId: pedido.id, enviados: destinatarios.length };
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
  pedidoId: string,
  detalhes: Record<string, string>,
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const end = endereco.trim();
  if (end.length < 5) return { ok: false as const, error: "Informe o endereço completo do serviço." };

  /* Mescla com o que a triagem já tinha gravado, em vez de sobrescrever: as
     chaves da calculadora (area_m2, ambiente, num_pessoas…) são promovidas para
     colunas de `jobs` por `aceitar_quote` e não podem se perder aqui. */
  if (Object.keys(detalhes).length > 0) {
    const { data: atual } = await supabase
      .from("quote_requests").select("detalhes").eq("id", pedidoId).single();
    const merged = { ...((atual?.detalhes ?? {}) as Record<string, string>), ...detalhes };
    const { error: dErr } = await supabase
      .from("quote_requests").update({ detalhes: merged }).eq("id", pedidoId);
    if (dErr) return { ok: false as const, error: dErr.message };
  }

  const { data, error } = await supabase.rpc("aceitar_quote", { p_quote_id: quoteId, p_endereco: end });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/orcamentos");
  revalidatePath("/painel");
  return { ok: true as const, jobId: data as string };
}

/** O profissional declina o pedido. Sinaliza ao cliente sem deixá-lo esperando
 *  uma resposta que não vem. */
export async function recusarPedido(pedidoId: string, motivo: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { error } = await supabase
    .from("quote_request_targets")
    .update({ recusado_em: new Date().toISOString(), motivo_recusa: motivo.trim() || null })
    .eq("quote_request_id", pedidoId)
    .eq("professional_id", user.id);

  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/orcamentos");
  return { ok: true as const };
}

/** Cliente desiste do pedido antes de aceitar qualquer proposta. */
export async function cancelarPedido(pedidoId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("quote_requests")
    .update({ status: "cancelado" })
    .eq("id", pedidoId)
    .eq("status", "aberto");

  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/painel/orcamentos");
  return { ok: true as const };
}
