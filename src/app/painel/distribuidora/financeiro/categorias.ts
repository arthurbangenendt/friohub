// Categorias de despesa da distribuidora.
//
// Fora de actions.ts pelo mesmo motivo de painel/financeiro/categorias.ts:
// módulo "use server" não pode exportar constante — vira referência de server
// action no bundle do cliente e quebra em runtime sem erro de build/tsc/lint.
//
// Categorias de operação de armazém/distribuição, não as de campo do técnico
// (sem "deslocamento"/"gás refrigerante" — quem lança aqui não presta serviço).
// Os mesmos ids estão no CHECK de `distributor_expenses.categoria`.
export const CATEGORIAS_DESPESA_DIST = [
  { id: "frete", label: "Frete / logística" },
  { id: "armazenagem", label: "Armazenagem" },
  { id: "terceiros", label: "Equipe / terceiros" },
  { id: "imposto", label: "Imposto / taxa" },
  { id: "outros", label: "Outros" },
] as const;

export const CATEGORIA_DIST_IDS: readonly string[] = CATEGORIAS_DESPESA_DIST.map((c) => c.id);
