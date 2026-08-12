// ============================================================================
// Cálculo de carga térmica simplificado (BTU/h) para ambientes residenciais.
//
// Regra de mercado usada no Brasil, com fatores de correção:
//   - base ~600 BTU/h por m² (ambiente comum, até 2 pessoas)
//   - +800 BTU/h por m² quando há muito sol / laje / último andar
//   - +600 BTU/h por pessoa acima de 2
//   - +600 BTU/h por aparelho eletrônico relevante (TV, PC) — opcional
//
// É assistivo: não substitui projeto de engenharia. Serve para dar ao cliente
// uma recomendação de capacidade e filtrar o catálogo.
// ============================================================================

export const CAPACIDADES_PADRAO = [9000, 12000, 18000, 24000, 30000, 36000] as const;

export type BtuInput = {
  areaM2: number;
  numPessoas: number;
  insolacaoAlta: boolean; // pega muito sol
  andarOuTelhado: boolean; // laje exposta / último andar
  eletronicos?: number; // qtd de aparelhos que geram calor (opcional)
};

export type BtuResultado = {
  btuCalculado: number;
  btuRecomendado: number; // capacidade padrão mais próxima acima
  detalhe: { label: string; valor: number }[];
};

export function calcularBtu(input: BtuInput): BtuResultado {
  const area = Math.max(0, input.areaM2 || 0);
  const pessoas = Math.max(1, input.numPessoas || 1);
  const eletronicos = Math.max(0, input.eletronicos ?? 0);

  const btuPorM2 = input.insolacaoAlta || input.andarOuTelhado ? 800 : 600;
  const base = area * btuPorM2;
  const extraPessoas = Math.max(0, pessoas - 2) * 600;
  const extraEletronicos = eletronicos * 600;

  const btuCalculado = Math.round(base + extraPessoas + extraEletronicos);
  const btuRecomendado =
    CAPACIDADES_PADRAO.find((c) => c >= btuCalculado) ??
    CAPACIDADES_PADRAO[CAPACIDADES_PADRAO.length - 1];

  return {
    btuCalculado,
    btuRecomendado,
    detalhe: [
      { label: `Área (${area} m² × ${btuPorM2})`, valor: Math.round(base) },
      { label: `Pessoas acima de 2 (${Math.max(0, pessoas - 2)})`, valor: extraPessoas },
      ...(eletronicos > 0 ? [{ label: `Eletrônicos (${eletronicos})`, valor: extraEletronicos }] : []),
    ],
  };
}

export function formatarBtu(btu: number): string {
  return btu.toLocaleString("pt-BR") + " BTU/h";
}
