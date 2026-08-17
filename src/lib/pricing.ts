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
 * calculado no banco — por `aceitar_quote` (order da visita/preço fechado) e
 * por `aprovar_orcamento_final` (order do serviço pós-visita) — a partir de
 * `platform_config.comissao_servico_pct`. Mudar a taxa exige mudar nos dois
 * lugares, e o que vale é o do banco.
 *
 * 4% desde 2026-08-17 (antes: 7% desde 2026-08-14, e 15% até então) — ver
 * 20260817140000_comissao_servico_4pct. Ordens criadas antes disso guardam a
 * comissão em reais e seguem na taxa vigente na hora; as telas que mostram o
 * valor cobrado leem `orders.comissao_servico`, não esta constante, então
 * histórico não fica errado. Só o rótulo do percentual usa este número. */
export const TAXA_COMISSAO = 0.04;

export function formatarBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
