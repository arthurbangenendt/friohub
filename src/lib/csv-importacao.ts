/* Parser da planilha de importação em massa (upload manual, sem ERP).
 *
 * Só trata o formato que a própria FrioHub gera no modelo baixável: cabeçalho
 * fixo, separador `;`, decimal com vírgula — mesma convenção BR/Excel já
 * usada em `painel/financeiro/exportar/route.ts`. Não é um parser de CSV
 * genérico (sem suporte a campo entre aspas com `;` embutido) — o valor de
 * marca/modelo não pode conter `;`, e isso está documentado no modelo.
 *
 * Os campos viram string no JSON (não number/boolean): `->>'campo'` no
 * Postgres extrai texto de qualquer jeito, então mandar "9000" ou 9000 dá no
 * mesmo pro validar_item_importacao — só precisamos normalizar separador
 * decimal/milhar ANTES de mandar, porque o cast SQL não entende "1.450,00".
 */

export const CABECALHO_PLANILHA = ["codigo", "marca", "modelo", "btu", "categoria", "custo", "quantidade", "ativo", "foto_url"] as const;

export type ItemPlanilha = {
  sku_distribuidor: string;
  marca: string;
  modelo: string;
  btu: string;
  categoria: string;
  custo: string;
  estoque_quantidade?: string;
  ativo: boolean;
  image_url?: string;
};

export type ResultadoParsePlanilha = {
  itens: ItemPlanilha[];
  erros: string[];
};

const CATEGORIAS_VALIDAS = new Set(["split", "inverter", "multi_split", "piso_teto", "janela"]);

function normalizarNumero(valor: string): string {
  // Remove separador de milhar (ponto) e troca vírgula decimal por ponto —
  // "1.450,00" -> "1450.00". Sem vírgula, só tira os pontos: "9.000" -> "9000".
  const limpo = valor.trim();
  if (!limpo) return "";
  return limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo.replace(/\./g, "");
}

function ehFalso(valor: string): boolean {
  const v = valor.trim().toLowerCase();
  return v === "não" || v === "nao" || v === "false" || v === "0";
}

export function gerarModeloPlanilha(): string {
  const linhaExemplo = ["EX-001", "Midea", "Springer Midea Xtreme Save 9000 BTU Inverter", "9000", "inverter", "1450,00", "10", "sim", ""];
  return `${CABECALHO_PLANILHA.join(";")}\n${linhaExemplo.join(";")}\n`;
}

/** Lê o texto do CSV (já decodificado) e devolve os itens prontos pra enviar
 *  a `ingerir_lote_produtos`, junto de erros de ESTRUTURA (coluna faltando,
 *  linha com número de campos errado). Regra de negócio (custo>0, categoria
 *  válida etc.) não é checada aqui — isso é responsabilidade única de
 *  `validar_campos_produto` no banco, pra não duplicar a regra em dois
 *  lugares. */
export function parsearPlanilhaImportacao(texto: string): ResultadoParsePlanilha {
  const semBom = texto.replace(/^﻿/, "");
  const linhas = semBom.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");

  if (linhas.length === 0) {
    return { itens: [], erros: ["A planilha está vazia."] };
  }

  const cabecalho = linhas[0].split(";").map((c) => c.trim().toLowerCase());
  const indice: Record<string, number> = {};
  for (const campo of CABECALHO_PLANILHA) {
    const pos = cabecalho.indexOf(campo);
    if (pos === -1) {
      return { itens: [], erros: [`Coluna "${campo}" não encontrada — baixe o modelo novamente e não renomeie o cabeçalho.`] };
    }
    indice[campo] = pos;
  }

  const itens: ItemPlanilha[] = [];
  const erros: string[] = [];

  for (let i = 1; i < linhas.length; i++) {
    const numeroLinha = i + 1; // +1 porque a linha 1 é o cabeçalho
    const colunas = linhas[i].split(";");
    if (colunas.length < CABECALHO_PLANILHA.length) {
      erros.push(`Linha ${numeroLinha}: número de colunas menor que o esperado — confira se não falta algum ";".`);
      continue;
    }

    const codigo = colunas[indice.codigo]?.trim() ?? "";
    if (!codigo) {
      erros.push(`Linha ${numeroLinha}: sem código do produto.`);
      continue;
    }

    const categoria = colunas[indice.categoria]?.trim().toLowerCase() ?? "";
    if (categoria && !CATEGORIAS_VALIDAS.has(categoria)) {
      erros.push(`Linha ${numeroLinha}: categoria "${categoria}" não é válida (use split, inverter, multi_split, piso_teto ou janela).`);
    }

    const quantidadeBruta = colunas[indice.quantidade]?.trim() ?? "";
    const fotoUrl = colunas[indice.foto_url]?.trim() ?? "";

    itens.push({
      sku_distribuidor: codigo,
      marca: colunas[indice.marca]?.trim() ?? "",
      modelo: colunas[indice.modelo]?.trim() ?? "",
      btu: normalizarNumero(colunas[indice.btu] ?? ""),
      categoria,
      custo: normalizarNumero(colunas[indice.custo] ?? ""),
      estoque_quantidade: quantidadeBruta ? normalizarNumero(quantidadeBruta) : undefined,
      ativo: !ehFalso(colunas[indice.ativo] ?? "sim"),
      image_url: fotoUrl || undefined,
    });
  }

  return { itens, erros };
}
