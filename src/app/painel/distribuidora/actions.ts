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

  /* Não dá pra usar `.upsert()` direto: `cnpj` não tem grant de SELECT (de
     propósito, pra não vazar o documento pra terceiros), e `INSERT ... ON
     CONFLICT DO UPDATE SET cnpj = ...` exige esse privilégio mesmo pra gravar
     a própria linha — Postgres recusa com "permission denied for table
     distributors". A RPC roda como definer e resolve isso. Ver
     20260818120000_salvar_perfil_distribuidora. */
  const { error } = await supabase.rpc("salvar_perfil_distribuidora", {
    p_razao_social: razao,
    p_cnpj: input.cnpj,
    p_cidade: input.cidade,
    p_prazo_entrega_dias: input.prazoEntregaDias,
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
  /* null = modo booleano legado (estoqueDisponivel manda). Número (>= 0) =
     modo de quantidade controlada: o trigger `protege_produto` deriva
     estoque_disponivel a partir dela, e `aceitar_quote` dá baixa aqui a cada
     venda. Ver 20260828120000_estoque_quantidade.sql. */
  estoqueQuantidade?: number | null;
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
  const estoqueQuantidade = input.estoqueQuantidade ?? null;
  if (estoqueQuantidade !== null && (!Number.isInteger(estoqueQuantidade) || estoqueQuantidade < 0)) {
    return { ok: false as const, error: "A quantidade em estoque precisa ser um número inteiro maior ou igual a zero." };
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
    estoque_quantidade: estoqueQuantidade,
  };

  const { error } = input.id
    ? await supabase.from("products").update(linha).eq("id", input.id).eq("distributor_id", user.id)
    : await supabase.from("products").insert(linha);

  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/distribuidora/catalogo");
  return { ok: true as const };
}

/* Só se aplica a produto em modo booleano legado (estoque_quantidade null) —
 * em modo de quantidade controlada, quem manda é o número, editado em
 * `salvarProduto`. */
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

/** Cadastra/troca Pix como forma de repasse — limpa dados bancários se houver
 *  (garantido pelo banco, `distributors_metodo_repasse_consistente`). Ver
 *  20260828150000_repasse_distribuidora_pix_ted.sql. */
export async function salvarRepassePix(chave: string, tipo: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { error } = await supabase.rpc("salvar_repasse_pix_distribuidora", {
    p_chave: chave,
    p_tipo: tipo,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/distribuidora/perfil");
  return { ok: true as const };
}

/** Cadastra/troca transferência bancária (TED) como forma de repasse — limpa
 *  Pix se houver. */
export async function salvarRepasseBancario(input: {
  bancoCodigo: string;
  agencia: string;
  conta: string;
  contaDigito: string;
  contaTipo: string;
  titularNome: string;
  titularDocumento: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { error } = await supabase.rpc("salvar_repasse_bancario_distribuidora", {
    p_banco_codigo: input.bancoCodigo,
    p_agencia: input.agencia,
    p_conta: input.conta,
    p_conta_digito: input.contaDigito,
    p_conta_tipo: input.contaTipo,
    p_titular_nome: input.titularNome,
    p_titular_documento: input.titularDocumento,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/distribuidora/perfil");
  return { ok: true as const };
}

/** Avança o repasse pela máquina de estados transacional do banco. */
export async function avancarRepasse(
  purchaseOrderId: string,
  para: string,
  extra?: { codigoRastreio?: string; linkRastreio?: string; notaFiscalUrl?: string },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  if (para === "enviado" && !extra?.linkRastreio?.trim()) {
    return { ok: false as const, error: "Cole o link de rastreio para marcar como enviado." };
  }
  if (extra?.linkRastreio?.trim() && !/^https?:\/\//i.test(extra.linkRastreio.trim())) {
    return { ok: false as const, error: "Link de rastreio inválido — cole a URL completa (começando com http:// ou https://)." };
  }

  const { error } = await supabase.rpc("avancar_purchase_order", {
    p_purchase_order_id: purchaseOrderId,
    p_status: para,
    p_codigo_rastreio: extra?.codigoRastreio?.trim() || undefined,
    p_nota_fiscal_url: extra?.notaFiscalUrl?.trim() || undefined,
    p_link_rastreio: extra?.linkRastreio?.trim() || undefined,
  });

  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/painel/distribuidora/pedidos");
  revalidatePath("/painel/distribuidora");
  return { ok: true as const };
}
