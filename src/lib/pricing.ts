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
 * exige mudar nos dois lugares, e o que vale é o do banco.
 *
 * 7% desde 2026-08-14 (antes: 15%) — ver 20260814210000_comissao_servico_7pct.
 * Ordens criadas antes disso guardam a comissão em reais e seguem em 15%; as
 * telas que mostram o valor cobrado leem `orders.comissao_servico`, não esta
 * constante, então histórico não fica errado. Só o rótulo do percentual usa
 * este número. */
export const TAXA_COMISSAO = 0.07;

export function formatarBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
