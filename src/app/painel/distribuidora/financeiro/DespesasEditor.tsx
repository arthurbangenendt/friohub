"use client";

import { DespesasEditor as Editor } from "@/components/ui/DespesasEditor";
import { registrarDespesaDistribuidora, removerDespesaDistribuidora } from "./actions";
import { CATEGORIAS_DESPESA_DIST } from "./categorias";

export type Despesa = {
  id: string;
  purchase_order_id: string | null;
  categoria: string;
  descricao: string | null;
  valor: number;
  data: string;
};

export type PedidoParaDespesa = { id: string; label: string };

/* Wrapper fino sobre o editor genérico (@/components/ui/DespesasEditor) — só
   traduz o vocabulário da distribuidora (purchase_order/pedido) e liga às
   actions dela. Espelha src/app/painel/financeiro/DespesasEditor.tsx. */
export function DespesasEditor({
  inicial,
  periodo,
  pedidos,
}: {
  inicial: Despesa[];
  periodo: string;
  pedidos: PedidoParaDespesa[];
}) {
  return (
    <Editor
      inicial={inicial.map((d) => ({ ...d, vinculoId: d.purchase_order_id }))}
      periodo={periodo}
      categorias={CATEGORIAS_DESPESA_DIST}
      itensVinculo={pedidos}
      vinculoLabel="Vincular a um pedido"
      vinculoPlaceholder="Despesa geral — não vincular"
      vinculoDica="Ao vincular, este custo será descontado de “Quanto sobrou em cada pedido”."
      registrar={(input) => registrarDespesaDistribuidora({ categoria: input.categoria, descricao: input.descricao, valor: input.valor, data: input.data, purchaseOrderId: input.vinculoId })}
      remover={removerDespesaDistribuidora}
    />
  );
}
