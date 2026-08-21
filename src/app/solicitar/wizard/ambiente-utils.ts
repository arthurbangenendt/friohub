import type { AmbienteForm } from "./types";
import { SUGESTOES_AMBIENTE } from "./constants";

let sequenciaAmbiente = 0;
export function novoAmbiente(nome: string): AmbienteForm {
  sequenciaAmbiente += 1;
  return {
    chave: `amb-${sequenciaAmbiente}`,
    nome,
    areaM2: 20,
    numPessoas: 2,
    eletronicos: 1,
    insolacaoAlta: false,
    andarOuTelhado: false,
    quantidade: 1,
    produtoId: null,
    produto: null,
  };
}

/* Sugere o próximo cômodo em vez de abrir um campo vazio. Reduzir o pedido de
   três ambientes a três cliques é o ponto inteiro desta tela. */
export function proximoNomeSugerido(existentes: AmbienteForm[]): string {
  const usados = new Set(existentes.map((a) => a.nome.trim().toLowerCase()));
  const sugestao = SUGESTOES_AMBIENTE.find((nome) => !usados.has(nome.toLowerCase()));
  return sugestao ?? `Ambiente ${existentes.length + 1}`;
}
