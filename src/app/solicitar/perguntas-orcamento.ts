import type { JobType } from "./tipos";

/* Questionário técnico do pedido de orçamento.
 *
 * O que faz o preço de um serviço de climatização variar quase nunca é o BTU —
 * é metragem de linha frigorígena, tipo de parede, acesso, infra elétrica e
 * dreno. Sem essas respostas o profissional só tem dois caminhos: chutar alto
 * para se proteger, ou não responder. Nos dois casos o cliente perde.
 *
 * As respostas vão para `quote_requests.detalhes` (jsonb). Ficam fora de colunas
 * tipadas de propósito: o conjunto muda com frequência, e cada mudança viraria
 * uma migration. As poucas chaves que `aceitar_quote` promove para colunas de
 * `jobs` — area_m2, ambiente, num_pessoas, insolacao_alta, andar_ou_telhado —
 * estão marcadas abaixo e NÃO devem ser renomeadas sem ajustar a função.
 *
 * "Não sei" é opção legítima em quase tudo: cliente não é técnico, e forçar
 * resposta errada é pior do que registrar a dúvida — é justamente o caso em que
 * o profissional responde propondo visita técnica.
 */

export type Pergunta = {
  id: string;
  label: string;
  tipo: "select" | "texto" | "numero";
  opcoes?: string[];
  dica?: string;
  /** Quando true, aparece com destaque: é das que mais mexem no preço. */
  chave?: boolean;
};

const NAO_SEI = "Não sei";

const INSTALACAO: Pergunta[] = [
  {
    id: "distancia_unidades",
    label: "Distância entre a unidade interna e a externa",
    tipo: "select",
    opcoes: ["Até 3 metros", "3 a 5 metros", "5 a 10 metros", "Mais de 10 metros", NAO_SEI],
    dica: "É o que mais pesa no preço: cada metro extra de tubulação é material e mão de obra.",
    chave: true,
  },
  {
    id: "infra_existente",
    label: "Já existe tubulação preparada no local?",
    tipo: "select",
    opcoes: ["Sim, e está em bom estado", "Sim, mas é antiga", "Não, precisa fazer do zero", NAO_SEI],
    chave: true,
  },
  {
    id: "local_condensadora",
    label: "Onde vai ficar a unidade externa",
    tipo: "select",
    opcoes: ["Mesma parede / varanda", "Fachada externa", "Laje ou telhado", "Área técnica do prédio", NAO_SEI],
    chave: true,
  },
  {
    id: "altura_acesso",
    label: "O local exige escada alta, andaime ou trabalho em altura?",
    tipo: "select",
    opcoes: ["Não, acesso simples", "Sim, escada alta", "Sim, andaime ou rapel", NAO_SEI],
    dica: "Trabalho em altura exige NR-35 e muda o custo.",
    chave: true,
  },
  {
    id: "eletrica",
    label: "Existe tomada com disjuntor dedicado para o aparelho?",
    tipo: "select",
    opcoes: ["Sim, já preparada", "Existe tomada comum por perto", "Não existe nada", NAO_SEI],
    chave: true,
  },
  {
    id: "tipo_parede",
    label: "Tipo da parede onde a unidade interna será fixada",
    tipo: "select",
    opcoes: ["Alvenaria (tijolo)", "Concreto armado", "Drywall", NAO_SEI],
  },
  {
    id: "dreno",
    label: "Já existe saída de dreno?",
    tipo: "select",
    opcoes: ["Sim", "Não", NAO_SEI],
  },
  /* Tipo de imóvel NÃO entra aqui: a triagem já perguntou (`tipoImovel`), e
     repetir pergunta é o jeito mais rápido de o cliente abandonar o pedido.
     O mesmo vale para ambiente, área e sintomas — tudo que a triagem coletou
     viaja junto em `detalhes` sem ser perguntado de novo. */
  {
    id: "condominio",
    label: "Se for apartamento: o condomínio tem regra para furo em fachada?",
    tipo: "select",
    opcoes: ["Não se aplica", "Não há restrição", "Sim, há regras", NAO_SEI],
  },
];

const MANUTENCAO_BASE: Pergunta[] = [
  {
    id: "tipo_equipamento",
    label: "Tipo do equipamento",
    tipo: "select",
    opcoes: ["Split Hi-Wall (parede)", "Piso-teto", "Cassete (4 vias)", "Janela", "Multi-split", "Portátil", NAO_SEI],
    chave: true,
  },
  {
    id: "altura_instalacao",
    label: "Altura em que o aparelho está instalado",
    tipo: "select",
    opcoes: ["Até 2,5 m", "Entre 2,5 m e 4 m", "Acima de 4 m", NAO_SEI],
    chave: true,
  },
  {
    id: "ultima_manutencao",
    label: "Quando foi a última manutenção",
    tipo: "select",
    opcoes: ["Nunca fez", "Menos de 1 ano", "1 a 2 anos", "Mais de 2 anos", NAO_SEI],
  },
  {
    id: "acesso",
    label: "Como é o acesso ao aparelho",
    tipo: "select",
    opcoes: ["Livre", "Precisa mover móveis", "Difícil / apertado"],
  },
];

const PERGUNTAS: Record<JobType, Pergunta[]> = {
  instalacao_com_equipamento: INSTALACAO,

  troca_equipamento: [
    ...INSTALACAO,
    {
      id: "retirada_antigo",
      label: "O que fazer com o aparelho antigo",
      tipo: "select",
      opcoes: ["Retirar e levar embora", "Retirar e deixar comigo", "Não há aparelho antigo"],
      chave: true,
    },
  ],

  // Sintomas já vêm dos chips da triagem (`PROBLEMAS` no wizard) — não repetir.
  manutencao: MANUTENCAO_BASE,

  limpeza: [
    ...MANUTENCAO_BASE,
    {
      id: "tipo_limpeza",
      label: "Tipo de limpeza",
      tipo: "select",
      opcoes: ["Higienização completa (química)", "Só limpeza de filtros", NAO_SEI],
      chave: true,
    },
  ],

  conserto: [
    // O defeito já foi marcado nos chips da triagem; aqui entra só o que falta
    // para dimensionar o reparo.
    { id: "marca", label: "Marca do aparelho", tipo: "texto", dica: "Ex.: Midea, LG, Springer" },
    { id: "modelo", label: "Modelo (se souber)", tipo: "texto" },
    {
      id: "idade_aparelho",
      label: "Idade aproximada do aparelho",
      tipo: "select",
      opcoes: ["Menos de 1 ano", "1 a 3 anos", "3 a 5 anos", "Mais de 5 anos", NAO_SEI],
      chave: true,
    },
    {
      id: "ja_mexeram",
      label: "Alguém já mexeu nesse aparelho antes?",
      tipo: "select",
      opcoes: ["Não", "Sim, outro técnico", NAO_SEI],
      dica: "Aparelho já remexido costuma exigir diagnóstico mais longo.",
    },
    ...MANUTENCAO_BASE.slice(0, 2),
  ],

  remanejamento: [
    {
      id: "distancia_novo_local",
      label: "Distância entre o local atual e o novo",
      tipo: "select",
      opcoes: ["Mesma parede", "Mesmo cômodo", "Outro cômodo", "Outro endereço", NAO_SEI],
      chave: true,
    },
    {
      id: "infra_destino",
      label: "No local novo já existe infraestrutura?",
      tipo: "select",
      opcoes: ["Sim", "Não, precisa fazer", NAO_SEI],
      chave: true,
    },
    {
      id: "tipo_parede",
      label: "Tipo da parede no local novo",
      tipo: "select",
      opcoes: ["Alvenaria (tijolo)", "Concreto armado", "Drywall", NAO_SEI],
    },
    {
      id: "altura_acesso",
      label: "O local exige escada alta, andaime ou trabalho em altura?",
      tipo: "select",
      opcoes: ["Não, acesso simples", "Sim, escada alta", "Sim, andaime ou rapel", NAO_SEI],
    },
    ...MANUTENCAO_BASE.slice(0, 1),
  ],

  // Balde genérico: o que existe de estruturado aqui é a descrição em texto e as fotos.
  outros: [],

  // Compra avulsa nunca passa por proposta/aceite de profissional — não tem
  // questionário técnico a perguntar.
  compra_equipamento: [],
};

export function perguntasDe(t: JobType): Pergunta[] {
  return PERGUNTAS[t] ?? [];
}

/** Rótulo legível de uma chave de `detalhes` — usado para exibir o pedido ao
 *  profissional sem depender do tipo de serviço. */
export function rotuloPergunta(jobType: JobType, id: string): string {
  const p = perguntasDe(jobType).find((q) => q.id === id);
  if (p) return p.label;
  return ROTULO_CALCULADORA[id] ?? id;
}

/* Chaves gravadas pela calculadora de BTU, não pelo questionário. `aceitar_quote`
   promove estas cinco para colunas de `jobs` — renomear aqui exige mexer na
   função no banco. */
const ROTULO_CALCULADORA: Record<string, string> = {
  area_m2: "Área do ambiente (m²)",
  ambiente: "Ambiente",
  num_pessoas: "Pessoas no ambiente",
  insolacao_alta: "Bate sol forte",
  andar_ou_telhado: "Último andar / telhado",
};
