// Categorias de despesa do profissional.
//
// Fora de actions.ts porque módulo "use server" não pode exportar constante:
// no bundle do cliente ela vira uma referência de server action e quebra em
// runtime — sem erro de build, de tsc ou de lint. Foi exatamente o que
// aconteceu e só o teste na aplicação pegou.
//
// Os mesmos ids estão no CHECK de `expenses.categoria`.
export const CATEGORIAS_DESPESA = [
  { id: "deslocamento", label: "Deslocamento" },
  { id: "material", label: "Material" },
  { id: "ferramenta", label: "Ferramenta" },
  { id: "gas", label: "Gás refrigerante" },
  { id: "terceiros", label: "Ajudante / terceiros" },
  { id: "imposto", label: "Imposto / taxa" },
  { id: "outros", label: "Outros" },
] as const;

export const CATEGORIA_IDS: readonly string[] = CATEGORIAS_DESPESA.map((c) => c.id);
