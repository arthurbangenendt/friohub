"use server";

import { createClient } from "@/lib/supabase/server";

export type ItemCompraAvulsa = { produtoId: string; quantidade: number };

/** Compra de equipamento/peça sem pedido de orçamento — ver
 *  20260828140000_compra_avulsa.sql. Mesmo padrão de best-effort de cobrança
 *  de `aceitarProposta` (painel/orcamentos/actions.ts): job/order já existem
 *  quando a cobrança é disparada, então uma falha aqui não desfaz a compra —
 *  fica pendente para o comprador tentar de novo em /servico/[id]. */
export async function criarCompraAvulsa(input: {
  itens: ItemCompraAvulsa[];
  cep: string;
  cidade: string;
  endereco: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  if (input.itens.length === 0) {
    return { ok: false as const, error: "Adicione ao menos um item ao carrinho." };
  }

  const { data, error } = await supabase.rpc("criar_compra_avulsa", {
    p_itens: input.itens,
    p_cep: input.cep,
    p_cidade: input.cidade,
    p_endereco: input.endereco,
  });
  if (error) return { ok: false as const, error: error.message };

  const jobId = data as string;

  const { data: order } = await supabase
    .from("orders")
    .select("id")
    .eq("job_id", jobId)
    .eq("origem", "aceite_quote")
    .maybeSingle();

  const { data: { session } } = await supabase.auth.getSession();
  if (session && order) {
    try {
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/asaas-cobrar-servico`;
      await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: order.id }),
      });
    } catch (erro) {
      console.error(`falha ao acionar cobrança da compra avulsa ${jobId}:`, erro);
    }
  }

  return { ok: true as const, jobId };
}
