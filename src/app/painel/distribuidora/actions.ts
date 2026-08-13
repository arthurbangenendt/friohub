"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/* Ações da distribuidora.
 *
 * Nada aqui grava preço de venda, verificação ou estado do repasse fora do que
 * as travas do banco permitem — `protege_produto` e `protege_confianca_distributor`
 * preservam em silêncio o que a distribuidora não pode escrever. Ver
 * 20260812260000_distribuidoras.sql.
 */

export type PerfilDistribuidora = {
  razaoSocial: string;
  cnpj: string;
  cidade: string;
  prazoEntregaDias: number;
  ufsAtendidas: string[];
};

export async function salvarPerfilDistribuidora(input: PerfilDistribuidora) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const razao = input.razaoSocial.trim();
  if (razao.length < 3) return { ok: false as const, error: "Informe a razão social." };

  const { error } = await supabase.from("distributors").upsert({
    id: user.id,
    razao_social: razao,
    cnpj: input.cnpj.replace(/\D/g, "") || null,
    cidade: input.cidade.trim() || "São Paulo",
    prazo_entrega_dias: Math.min(90, Math.max(0, input.prazoEntregaDias || 5)),
  });
  if (error) return { ok: false as const, error: error.message };

  /* Áreas são substituídas em bloco: não carregam histórico. Lista vazia
     significa "entrego em toda a praça" — ver o comentário da tabela. */
  await supabase.from("distributor_areas").delete().eq("distributor_id", user.id);
  const ufs = [...new Set(input.ufsAtendidas.map((u) => u.trim().toUpperCase()).filter((u) => u.length === 2))];
  if (ufs.length) {
    const { error: aErr } = await supabase
      .from("distributor_areas")
      .insert(ufs.map((uf) => ({ distributor_id: user.id, uf })));
    if (aErr) return { ok: false as const, error: aErr.message };
  }

  revalidatePath("/painel/distribuidora");
  revalidatePath("/painel/distribuidora/perfil");
  return { ok: true as const };
}

export type ProdutoInput = {
  id?: string;
  marca: string;
  modelo: string;
  btu: number;
  categoria: string;
  custo: number;
  imageUrl?: string | null;
  ativo: boolean;
  estoqueDisponivel: boolean;
};

/** Cria ou atualiza um produto do catálogo da distribuidora.
 *
 *  Repare que `preco_venda` NÃO é enviado: ele é derivado do custo pelo markup
 *  da plataforma, num trigger. Quem informa o preço final é a FrioHub, não a
 *  distribuidora. */
export async function salvarProduto(input: ProdutoInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const marca = input.marca.trim();
  const modelo = input.modelo.trim();
  if (marca.length < 2 || modelo.length < 3) {
    return { ok: false as const, error: "Informe marca e modelo." };
  }
  if (!(input.custo > 0)) {
    return { ok: false as const, error: "Informe o custo do aparelho." };
  }

  const linha = {
    distributor_id: user.id,
    marca,
    modelo,
    btu: Math.max(0, Math.round(input.btu) || 0),
    categoria: input.categoria,
    custo: input.custo,
    image_url: input.imageUrl?.trim() || null,
    ativo: input.ativo,
    estoque_disponivel: input.estoqueDisponivel,
    // Obrigatório no schema (not null) e imediatamente sobrescrito pelo trigger
    // de markup. Ver `aplica_markup_produto`.
    preco_venda: 0,
  };

  const { error } = input.id
    ? await supabase.from("products").update(linha).eq("id", input.id).eq("distributor_id", user.id)
    : await supabase.from("products").insert(linha);

  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/distribuidora/catalogo");
  return { ok: true as const };
}

export async function alternarEstoque(produtoId: string, disponivel: boolean) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { error } = await supabase
    .from("products")
    .update({ estoque_disponivel: disponivel })
    .eq("id", produtoId)
    .eq("distributor_id", user.id);

  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/painel/distribuidora/catalogo");
  return { ok: true as const };
}

const FLUXO: Record<string, string[]> = {
  a_repassar: ["confirmado", "cancelado"],
  confirmado: ["faturado", "cancelado"],
  faturado: ["enviado", "cancelado"],
  enviado: ["entregue"],
  entregue: [],
  cancelado: [],
};

/** Avança o repasse. A ordem dos estados é validada aqui porque o banco só
 *  restringe o VOCABULÁRIO (CHECK), não a sequência. */
export async function avancarRepasse(
  purchaseOrderId: string,
  para: string,
  extra?: { codigoRastreio?: string; notaFiscalUrl?: string },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { data: atual } = await supabase
    .from("purchase_orders")
    .select("status")
    .eq("id", purchaseOrderId)
    .maybeSingle();

  if (!atual) return { ok: false as const, error: "Pedido não encontrado." };
  if (!(FLUXO[atual.status] ?? []).includes(para)) {
    return { ok: false as const, error: `Não é possível ir de "${atual.status}" para "${para}".` };
  }
  if (para === "enviado" && !extra?.codigoRastreio?.trim()) {
    return { ok: false as const, error: "Informe o código de rastreio para marcar como enviado." };
  }

  const { error } = await supabase
    .from("purchase_orders")
    .update({
      status: para,
      ...(extra?.codigoRastreio ? { codigo_rastreio: extra.codigoRastreio.trim() } : {}),
      ...(extra?.notaFiscalUrl ? { nota_fiscal_url: extra.notaFiscalUrl.trim() } : {}),
    })
    .eq("id", purchaseOrderId);

  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/distribuidora/pedidos");
  revalidatePath("/painel/distribuidora");
  return { ok: true as const };
}
