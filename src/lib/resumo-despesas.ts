import type { ExpenseItem } from "@/components/ui/card-20";

/* Sem "use client": esta lógica é usada tanto pelo editor de despesas
   (Client Component, donut interativo) quanto pelas fichas financeiras do
   admin (Server Component, read-only). Um módulo "use client" transforma
   TODO export em referência de Client Component — mesmo uma função pura — e
   o React quebra em runtime ao tentar chamá-la do servidor. Foi exatamente
   isso que aconteceu quando essa função ainda morava em
   components/ui/DespesasEditor.tsx. */

const CORES = ["var(--chart-1)", "var(--chart-2)", "var(--good)", "var(--warning)"];

/** Top 3 categorias por valor + "Outras" agregado — usado no donut do editor
 *  de despesas e, read-only, nas fichas financeiras do admin. */
export function resumirCategorias(lista: { categoria: string; valor: number }[], label: Record<string, string>): ExpenseItem[] {
  const totais = new Map<string, number>();
  for (const item of lista) totais.set(item.categoria, (totais.get(item.categoria) ?? 0) + item.valor);
  const ordenadas = [...totais.entries()].sort((a, b) => b[1] - a[1]);
  const principais: ExpenseItem[] = ordenadas.slice(0, 3).map(([categoria, amount], index) => ({
    category: label[categoria] ?? categoria,
    amount,
    color: CORES[index],
  }));
  const restante = ordenadas.slice(3).reduce((soma, [, valor]) => soma + valor, 0);
  if (restante > 0) principais.push({ category: "Outras", amount: restante, color: CORES[3] });
  return principais;
}
