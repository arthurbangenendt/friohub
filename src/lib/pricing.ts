// Preço tabelado da mão de obra de instalação, por faixa de capacidade.
// (No modelo, a instalação tem preço da plataforma; o profissional é a mão de obra.)
export function precoInstalacao(btu: number): number {
  if (btu <= 12000) return 350;
  if (btu <= 18000) return 450;
  if (btu <= 24000) return 600;
  return 750;
}

/* Comissão da plataforma sobre a mão de obra (receita nº 2).
 *
 * ATENÇÃO: este valor é só para EXIBIR o percentual na tela. O valor cobrado é
 * calculado no banco, por `criar_order`, a partir de `platform_config
 * .comissao_servico_pct` — ver 20260812220000_trava_jobs_reviews. Mudar a taxa
 * exige mudar nos dois lugares, e o que vale é o do banco. */
export const TAXA_COMISSAO = 0.15;

export function formatarBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
