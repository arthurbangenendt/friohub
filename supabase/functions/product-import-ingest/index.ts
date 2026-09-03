/* Ingresso do sync em massa de catálogo — chamado pelo ERP da distribuidora.
 *
 * Autenticação por API key (`Authorization: Bearer fh_live_...`), validada
 * por `validar_chave_api` — NUNCA por sessão de usuário Supabase, porque não
 * existe sessão nenhuma aqui: quem chama é o sistema da distribuidora, não
 * uma pessoa logada no painel.
 *
 * Mesmo espírito do `asaas-webhook`: grava cru (`ingerir_lote_produtos`) e
 * responde rápido. A validação de campo e a busca de imagem ficam pro worker
 * periódico `product-import-processor` — ver 20260903120000 e 20260903130000.
 *
 * `GET .../product-import-ingest/{batch_id}` devolve o status do lote pro
 * ERP poder consultar sem precisar abrir o painel.
 */

import { servico, json } from "../_shared/supabase.ts";

const LIMITE_ITENS = 2000;

type ItemPayload = {
  sku_distribuidor?: string;
  marca?: string;
  modelo?: string;
  btu?: number;
  categoria?: string;
  custo?: number;
  estoque_quantidade?: number;
  ativo?: boolean;
  image_url?: string;
};

type LotePayload = {
  idempotency_key?: string;
  itens?: ItemPayload[];
};

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const segmentos = url.pathname.split("/").filter(Boolean);
  const ultimoSegmento = segmentos[segmentos.length - 1] ?? "";
  const batchIdNaUrl = ultimoSegmento !== "product-import-ingest" ? ultimoSegmento : null;

  const cabecalhoAuth = req.headers.get("authorization") ?? "";
  const chave = cabecalhoAuth.replace(/^Bearer\s+/i, "").trim();
  if (!chave) return json({ error: "Chave de API ausente." }, 401);

  const db = servico();

  const { data: validacao, error: erroValidacao } = await db.rpc("validar_chave_api", { p_chave: chave });
  if (erroValidacao) {
    console.error(`product-import-ingest: falha ao validar chave: ${erroValidacao.message}`);
    return json({ error: "Não foi possível validar a chave." }, 500);
  }
  const resultado = Array.isArray(validacao) ? validacao[0] : null;
  if (!resultado?.distributor_id) {
    return json({ error: "Chave inválida, revogada, ou distribuidora não verificada/ativa." }, 401);
  }

  if (req.method === "GET" && batchIdNaUrl) {
    const { data: batch, error } = await db
      .from("product_import_batches")
      .select("status, total_items, valid_items, error_items")
      .eq("id", batchIdNaUrl)
      .eq("distributor_id", resultado.distributor_id)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!batch) return json({ error: "Lote não encontrado." }, 404);
    return json(batch);
  }

  if (req.method !== "POST") return json({ error: "Método não suportado." }, 405);

  let corpo: LotePayload;
  try {
    corpo = await req.json();
  } catch {
    return json({ error: "Corpo não é JSON." }, 400);
  }

  const itens = Array.isArray(corpo.itens) ? corpo.itens : null;
  if (!itens || itens.length === 0) {
    return json({ error: 'Informe um array "itens" com ao menos 1 produto.' }, 422);
  }
  if (itens.length > LIMITE_ITENS) {
    return json({ error: `Lote acima do limite de ${LIMITE_ITENS} itens — pagine em mais de uma chamada.` }, 422);
  }

  const { data: batchId, error: erroIngestao } = await db.rpc("ingerir_lote_produtos", {
    p_distributor_id: resultado.distributor_id,
    p_idempotency_key: corpo.idempotency_key ?? null,
    p_itens: itens,
  });

  if (erroIngestao || !batchId) {
    const mensagem = erroIngestao?.message ?? "Falha ao registrar o lote.";
    console.error(`product-import-ingest: falha na ingestão (distribuidora ${resultado.distributor_id}): ${mensagem}`);
    const status = mensagem.includes("Limite de solicitações") ? 429 : 422;
    return json({ error: mensagem }, status);
  }

  const origem = Deno.env.get("FRIOHUB_APP_URL") ?? "";
  return json(
    {
      batch_id: batchId,
      status: "staged",
      total_itens: itens.length,
      preview_url: origem ? `${origem}/painel/distribuidora/importacoes/${batchId}` : undefined,
    },
    202,
  );
});
