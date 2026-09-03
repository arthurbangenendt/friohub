/* Taxonomia de produto — fonte única do enum de categoria.
 *
 * Extraído de `CatalogoEditor.tsx` ao criar a tela de preview da importação
 * em massa, que também precisa rotular categoria. Os valores espelham o
 * CHECK de `products.categoria` no banco (`validar_campos_produto`,
 * 20260903130000) — mudar aqui sem mudar lá (ou vice-versa) deixa a tela
 * aceitar um valor que o banco recusa. */
export const CATEGORIAS = ["split", "inverter", "multi_split", "piso_teto", "janela"] as const;

export const CAT_LABEL: Record<string, string> = {
  split: "Split",
  inverter: "Inverter",
  multi_split: "Multi-split",
  piso_teto: "Piso-teto",
  janela: "Janela",
};
