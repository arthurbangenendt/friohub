export const CATEGORIAS_FERRAMENTA = [
  { id: "diagnostico", label: "Diagnóstico" },
  { id: "instalacao", label: "Instalação" },
  { id: "refrigeracao", label: "Refrigeração" },
  { id: "eletrica", label: "Elétrica" },
  { id: "limpeza", label: "Limpeza" },
  { id: "seguranca", label: "Segurança" },
  { id: "outros", label: "Outros" },
] as const;

export const CATEGORIA_FERRAMENTA_IDS: readonly string[] = CATEGORIAS_FERRAMENTA.map(
  (categoria) => categoria.id,
);
