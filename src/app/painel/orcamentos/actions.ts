"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { JobType } from "@/app/solicitar/tipos";
import { validarDocumento } from "@/lib/documento";
import { MAX_AMBIENTES, MAX_DESTINATARIOS } from "./config";

/* Orçamentos (RFQ).
 *
 * Este é o caminho padrão de contratação: o cliente descreve uma vez e envia
 * para vários profissionais; cada um responde com preço fechado ou proposta de
 * visita técnica; o cliente aceita uma, e é o aceite que cria o job com preço e
 * a comissão da plataforma. Ver 20260812240000_orcamentos.sql.
 */

/* Um ambiente do pedido. Climatizar a casa inteira é um pedido só com N itens:
   o cliente descreve uma vez, recebe uma proposta pelo pacote e o técnico faz
   tudo numa visita. Ver 20260817120000_pedido_multi_ambiente.sql. */
export type ItemPedido = {
  ambiente: string;
  areaM2?: number | null;
  numPessoas?: number | null;
  eletronicos?: number | null;
  insolacaoAlta?: boolean;
  andarOuTelhado?: boolean;
  btuRecomendado?: number | null;
  produtoId?: string | null;
  /* Só quando o cliente não sabia qual aparelho queria: categoria escolhida,
     sem produto exato — quem completa isso é o profissional, na proposta. */
  categoriaDesejada?: string | null;
  quantidade: number;
};

export type NovoPedido = {
  jobType: JobType;
  cep: string;
  cidade: string;
  bairro?: string;
  itens: ItemPedido[];
  urgencia?: "sem_pressa" | "proximos_dias" | "urgente";
  descricao?: string;
  detalhes: Record<string, string>;
  /* Produto e BTU não vivem mais no topo do pedido: cada ambiente tem o seu.
     As colunas singulares de `quote_requests` continuam existindo, mas quem as
     preenche é a RPC, espelhando o primeiro item. */
  profissionaisIds: string[];
  fotos?: string[];
  latitude?: number | null;
  longitude?: number | null;
  /* true = cliente escolheu o produto exato (preço de catálogo travado).
     false = cliente só informou a categoria; o profissional escolhe o
     produto e o preço na proposta. Ver 20260819100000_pedido_aparelho_conhecido.sql. */
  sabeAparelho: boolean;
};

export async function criarPedidoOrcamento(input: NovoPedido) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Faça login para pedir orçamento." };

  const destinatarios = [...new Set(input.profissionaisIds)];
  if (destinatarios.length === 0 || destinatarios.length > MAX_DESTINATARIOS) {
    return { ok: false as const, error: `Escolha entre um e ${MAX_DESTINATARIOS} profissionais.` };
  }

  /* O banco também valida isto (a RPC recusa ambiente sem nome e o trigger
     limita a 20). Aqui a checagem existe só para virar mensagem legível antes
     de gastar uma ida ao servidor. */
  const itens = (input.itens ?? [])
    .map((item) => ({ ...item, ambiente: item.ambiente.trim() }))
    .filter((item) => item.ambiente.length > 0);
  if (itens.length === 0) {
    return { ok: false as const, error: "Informe pelo menos um ambiente." };
  }
  if (itens.length > MAX_AMBIENTES) {
    return { ok: false as const, error: `Um pedido aceita no máximo ${MAX_AMBIENTES} ambientes.` };
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
    /* `quantidade` deixou de ser digitada pelo cliente: a RPC a recalcula
       somando os aparelhos de cada ambiente. Continua no payload porque a
       assinatura da função a exige. */
    p_quantidade: itens.reduce((total, item) => total + Math.max(1, item.quantidade), 0),
    p_urgencia: input.urgencia ?? "",
    p_descricao: input.descricao ?? "",
    p_detalhes: input.detalhes ?? {},
    /* Produto e BTU singulares seguem espelhando o primeiro ambiente — a RPC
       refaz esse espelho de qualquer forma, mas mandar coerente evita que uma
       chamada antiga grave um produto que não é de ambiente nenhum. */
    p_produto_id: itens[0].produtoId ?? "",
    p_btu_recomendado: itens[0].btuRecomendado ?? 0,
    p_profissionais_ids: destinatarios,
    p_fotos: fotos,
    p_latitude: coordenadasValidas ? Number(input.latitude) : undefined,
    p_longitude: coordenadasValidas ? Number(input.longitude) : undefined,
    p_itens: itens.map((item) => ({
      ambiente: item.ambiente,
      area_m2: item.areaM2 ?? null,
      num_pessoas: item.numPessoas ?? null,
      eletronicos: item.eletronicos ?? null,
      insolacao_alta: item.insolacaoAlta ?? false,
      andar_ou_telhado: item.andarOuTelhado ?? false,
      btu_recomendado: item.btuRecomendado ?? null,
      produto_id: item.produtoId ?? null,
      categoria_desejada: item.categoriaDesejada ?? null,
      quantidade: Math.max(1, item.quantidade),
    })),
    p_sabe_aparelho: input.sabeAparelho,
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
  /* Só quando o cliente não sabia qual aparelho queria: o produto que o
     profissional escolheu da distribuidora, e o preço que vai cobrar por ele.
     Quando o cliente já escolheu o produto, o banco rejeita estes dois campos —
     o preço do aparelho é 100% do catálogo. */
  produtoId?: string | null;
  valorEquipamento?: number;
};

export async function enviarProposta(input: PropostaInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const naoNeg = (n: number) => Math.max(0, Number.isFinite(n) ? n : 0);
  const maoObra = naoNeg(input.valorMaoObra);
  const materiais = naoNeg(input.valorMateriais);
  const visita = naoNeg(input.valorVisita);
  const equipamento = naoNeg(input.valorEquipamento ?? 0);

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
    produto_id: input.produtoId ?? null,
    valor_equipamento: equipamento,
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
  /* Só vem preenchido quando a cobrança real está ligada pra esta região e o
     cliente ainda não tinha documento salvo — ver Propostas.tsx. */
  cpfCnpj?: string,
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const end = endereco.trim();
  if (end.length < 5) return { ok: false as const, error: "Informe o endereço completo do serviço." };

  if (cpfCnpj) {
    if (!validarDocumento(cpfCnpj)) {
      return { ok: false as const, error: "Informe um CPF ou CNPJ válido." };
    }
    const digitos = cpfCnpj.replace(/\D/g, "");
    /* Coleta única, mesmo padrão do CPF/CNPJ do profissional na assinatura
       (20260818141000): só grava se ainda não houver documento salvo — não
       sobrescreve o que já existe.
       Duas etapas porque conta anterior a 12/08 (antes do documento virar
       obrigatório no cadastro) não tem NENHUMA linha em `profile_private` —
       um `update` sozinho não cria linha, então "funciona" sem erro e não
       salva nada. `upsert` com `ignoreDuplicates` cria a linha só se faltar
       (não mexe em quem já tem linha, com ou sem documento); o `update`
       depois cobre quem já tinha linha mas ainda sem documento. */
    const { error: erroCriarLinha } = await supabase
      .from("profile_private")
      .upsert({ id: user.id, cpf_cnpj: digitos }, { onConflict: "id", ignoreDuplicates: true });
    if (erroCriarLinha) return { ok: false as const, error: "Não foi possível salvar o CPF/CNPJ." };

    const { error: erroDocumento } = await supabase
      .from("profile_private")
      .update({ cpf_cnpj: digitos })
      .eq("id", user.id)
      .is("cpf_cnpj", null);
    if (erroDocumento) return { ok: false as const, error: "Não foi possível salvar o CPF/CNPJ." };
  }

  const { data, error } = await supabase.rpc("aceitar_quote", {
    p_quote_id: quoteId,
    p_endereco: end,
    p_detalhes: detalhes,
  });
  if (error) return { ok: false as const, error: error.message };

  const jobId = data as string;

  /* Best-effort: job e order já existem, são a fonte de verdade. Se a
     cobrança falhar (gateway fora do ar, flag desligada, cliente sem
     documento), o aceite não é desfeito — fica pendente para a reconciliação
     resolver depois. Ver supabase/functions/asaas-cobrar-servico. */
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    /* Aguardado de propósito: em ambiente serverless, uma promise disparada
       sem `await` pode ser encerrada junto com a function antes do fetch
       terminar. O erro é engolido — best-effort não pode virar falha do
       aceite, que já está commitado no banco. */
    try {
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/asaas-cobrar-servico`;
      await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId }),
      });
    } catch (erro) {
      console.error(`falha ao acionar cobrança do serviço ${jobId}:`, erro);
    }
  }

  revalidatePath("/painel/orcamentos");
  revalidatePath("/painel");
  return { ok: true as const, jobId };
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
