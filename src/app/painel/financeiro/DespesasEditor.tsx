"use client";

import { DespesasEditor as Editor } from "@/components/ui/DespesasEditor";
import { registrarDespesa, removerDespesa } from "./actions";
import { CATEGORIAS_DESPESA } from "./categorias";

export type Despesa = {
  id: string;
  job_id: string | null;
  categoria: string;
  descricao: string | null;
  valor: number;
  data: string;
};

export type ServicoParaDespesa = { id: string; label: string };

/* Wrapper fino sobre o editor genérico (@/components/ui/DespesasEditor) — só
   traduz o vocabulário do técnico (job/serviço) e liga às actions dele. */
export function DespesasEditor({
  inicial,
  periodo,
  servicos,
}: {
  inicial: Despesa[];
  periodo: string;
  servicos: ServicoParaDespesa[];
}) {
  return (
    <Editor
      inicial={inicial.map((d) => ({ ...d, vinculoId: d.job_id }))}
      periodo={periodo}
      categorias={CATEGORIAS_DESPESA}
      itensVinculo={servicos}
      vinculoLabel="Vincular a um serviço"
      vinculoPlaceholder="Despesa geral — não vincular"
      vinculoDica="Ao vincular, este custo será descontado de “Quanto sobrou em cada serviço”."
      registrar={(input) => registrarDespesa({ categoria: input.categoria, descricao: input.descricao, valor: input.valor, data: input.data, jobId: input.vinculoId })}
      remover={removerDespesa}
    />
  );
}
