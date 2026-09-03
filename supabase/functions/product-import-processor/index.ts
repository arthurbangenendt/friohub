/* Worker de validação da importação em massa — processa a fila de
 * `product_import_items` pendentes: casa por SKU (insert vs update), roda a
 * validação de campo, e busca/re-hospeda a imagem informada pelo ERP.
 *
 * Acordado por `disparar_worker_importacao_produtos()` via pg_net uma vez
 * por minuto (20260903140000) — não recebe JWT de usuário, só a chave
 * guardada no Vault (`product_import_worker_key`), mesmo padrão de
 * `asaas-renovar-assinaturas`.
 *
 * Falha ao buscar imagem NÃO bloqueia o item: fica registrada em
 * `image_status = 'failed'` e o item segue validado pelos campos de negócio
 * normalmente (decisão registrada no plano — foto é sempre best-effort).
 */

import { servico, json } from "../_shared/supabase.ts";

const WORKER_KEY = Deno.env.get("PRODUCT_IMPORT_WORKER_KEY") ?? "";
const TAMANHO_LOTE = 50;
const MAX_IMAGEM_BYTES = 8 * 1024 * 1024;
const TIPOS_IMAGEM_ACEITOS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function comparacaoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

type ItemFila = {
  id: string;
  batch_id: string;
  image_url_original: string | null;
};

type Servico = ReturnType<typeof servico>;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método não suportado." }, 405);

  if (!WORKER_KEY) return json({ error: "Worker não configurado." }, 500);
  const chaveRecebida = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!comparacaoConstante(chaveRecebida, WORKER_KEY)) {
    return json({ error: "Não autorizado." }, 401);
  }

  const db = servico();

  const { data: fila, error: erroFila } = await db.rpc("reservar_itens_para_validar", { p_limit: TAMANHO_LOTE });
  if (erroFila) {
    console.error(`product-import-processor: falha ao reservar fila: ${erroFila.message}`);
    return json({ error: erroFila.message }, 500);
  }

  const itens = (fila ?? []) as ItemFila[];
  if (itens.length === 0) return json({ ok: true, total: 0, validados: 0, falhas: 0 });

  const batchIds = [...new Set(itens.map((i) => i.batch_id))];
  const { data: batches, error: erroBatches } = await db
    .from("product_import_batches")
    .select("id, distributor_id")
    .in("id", batchIds);
  if (erroBatches) {
    console.error(`product-import-processor: falha ao resolver lotes: ${erroBatches.message}`);
    return json({ error: erroBatches.message }, 500);
  }
  const distributorPorBatch = new Map((batches ?? []).map((b) => [b.id as string, b.distributor_id as string]));

  let validados = 0;
  let falhas = 0;

  for (const item of itens) {
    try {
      if (item.image_url_original) {
        const distributorId = distributorPorBatch.get(item.batch_id);
        if (distributorId) await processarImagem(db, item, distributorId);
      }
      const { error } = await db.rpc("validar_item_importacao", { p_item_id: item.id });
      if (error) throw new Error(error.message);
      validados++;
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      console.error(`product-import-processor: falha no item ${item.id}: ${mensagem}`);
      falhas++;
    }
  }

  for (const batchId of batchIds) {
    const { error } = await db.rpc("fechar_validacao_lote", { p_batch_id: batchId });
    if (error) console.error(`product-import-processor: falha ao fechar lote ${batchId}: ${error.message}`);
  }

  return json({ ok: true, total: itens.length, validados, falhas });
});

async function processarImagem(db: Servico, item: ItemFila, distributorId: string) {
  const url = item.image_url_original!;
  try {
    if (!/^https?:\/\//i.test(url)) throw new Error("URL de imagem não é http(s).");

    const resposta = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resposta.ok) throw new Error(`fetch retornou ${resposta.status}`);

    const contentType = resposta.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    const ext = TIPOS_IMAGEM_ACEITOS[contentType];
    if (!ext) throw new Error(`content-type não suportado: ${contentType || "desconhecido"}`);

    const bytes = new Uint8Array(await resposta.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error("imagem vazia");
    if (bytes.byteLength > MAX_IMAGEM_BYTES) throw new Error("imagem acima de 8MB");

    const path = `${distributorId}/importacoes/${item.batch_id}/${item.id}.${ext}`;
    const { error: erroUpload } = await db.storage.from("produtos").upload(path, bytes, {
      cacheControl: "31536000",
      contentType,
      upsert: true,
    });
    if (erroUpload) throw new Error(erroUpload.message);

    const { data: pub } = db.storage.from("produtos").getPublicUrl(path);
    await db.rpc("registrar_imagem_importada", { p_item_id: item.id, p_url: pub.publicUrl, p_erro: null });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await db.rpc("registrar_imagem_importada", { p_item_id: item.id, p_url: null, p_erro: mensagem });
  }
}
