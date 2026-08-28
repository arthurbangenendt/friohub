import { Wind, Wrench, Droplet, Move, Tool } from "@/components/icons";
import { aceitaCatalogo, type JobType } from "../tipos";
import type { StepId } from "./types";

export const mono = "var(--font-geist-mono), ui-monospace, monospace";

type IconType = (p: { size?: number }) => React.ReactElement;
export const JOBS: { tipo: JobType; titulo: string; desc: string; Icon: IconType; catalogo: boolean }[] = [
  { tipo: "instalacao_com_equipamento", titulo: "Instalar ar novo", desc: "Comprar o aparelho + instalação", Icon: Wind, catalogo: true },
  { tipo: "troca_equipamento", titulo: "Trocar equipamento", desc: "Substituir o aparelho antigo", Icon: Move, catalogo: true },
  { tipo: "manutencao", titulo: "Manutenção", desc: "Revisão, gás, não gela", Icon: Wrench, catalogo: false },
  { tipo: "limpeza", titulo: "Limpeza", desc: "Higienização completa", Icon: Droplet, catalogo: false },
  { tipo: "remanejamento", titulo: "Remanejamento", desc: "Mudar o aparelho de lugar", Icon: Move, catalogo: false },
  { tipo: "conserto", titulo: "Conserto", desc: "Reparo de defeito", Icon: Tool, catalogo: false },
  { tipo: "outros", titulo: "Outro serviço", desc: "Descreva o que você precisa", Icon: Tool, catalogo: false },
];

// `outros` não mapeia especialidade: é um balde genérico, então mostramos todos
// os profissionais em vez de filtrar por uma skill que não existe.
export const SPECIALTY_OF: Record<JobType, string | null> = {
  instalacao_com_equipamento: "instalacao", troca_equipamento: "instalacao",
  manutencao: "manutencao", remanejamento: "remanejamento",
  limpeza: "limpeza", conserto: "conserto", outros: null,
  compra_equipamento: null,
};
export const SPECIALTY_LABEL: Record<string, string> = {
  instalacao: "Instalação", manutencao: "Manutenção", remanejamento: "Remanejamento", limpeza: "Limpeza", conserto: "Conserto",
};

// Sintomas comuns por tipo de serviço — ajudam o cliente a descrever o problema.
export const PROBLEMAS: Partial<Record<JobType, string[]>> = {
  manutencao: ["Não está gelando", "Gelando pouco", "Fazendo barulho", "Vazando água", "Cheiro ruim", "Revisão preventiva"],
  conserto: ["Não liga", "Desliga sozinho", "Não gela", "Barulho anormal", "Erro no display", "Suspeita de vazamento de gás"],
  limpeza: ["Higienização completa", "Mau cheiro", "Excesso de poeira", "Alergia / rinite", "Rotina periódica"],
  remanejamento: ["Mudar de parede", "Mudar de cômodo", "Mudança de endereço", "Reforma no ambiente"],
};
export const URGENCIAS = ["Sem pressa", "Nos próximos dias", "Urgente (hoje / amanhã)"];
// Rótulo exibido → valor aceito pelo CHECK de `quote_requests.urgencia`.
export const URGENCIA_ID: Record<string, "sem_pressa" | "proximos_dias" | "urgente" | undefined> = {
  "Sem pressa": "sem_pressa",
  "Nos próximos dias": "proximos_dias",
  "Urgente (hoje / amanhã)": "urgente",
};

export const TIPOS_IMOVEL = ["Casa", "Apartamento", "Escritório", "Loja", "Galpão"];
export const AMBIENTES = ["Sala", "Quarto", "Cozinha", "Escritório", "Loja", "Outro"];
/* Ordem de quem climatiza a casa aos poucos: sala primeiro, depois os quartos.
   É a sugestão do botão "Adicionar ambiente". */
export const SUGESTOES_AMBIENTE = [
  "Sala", "Quarto de casal", "Quarto 1", "Quarto 2", "Suíte",
  "Escritório", "Cozinha", "Sala de jantar",
];
export const PERIODOS = ["Durante o dia", "À noite", "O dia inteiro"];

export const STEP_LABEL: Record<StepId, string> = {
  servico: "Serviço", ambiente: "Ambiente", detalhes: "Detalhes", equipamento: "Aparelho",
  aparelho_conhecido: "Modelo do aparelho",
  catalogo: "Escolher aparelho", carrinho: "Carrinho", endereco: "Região", profissional: "Profissionais",
  confirmar: "Enviar",
};

/* Este wizard é TRIAGEM, e só isso: descobrir o aparelho certo e quais
 * profissionais atendem a região. Nada aqui pode repetir pergunta nem cobrar
 * esforço técnico do cliente.
 *
 * O questionário técnico (metragem de linha frigorígena, tipo de parede, acesso,
 * elétrica) NÃO vive aqui — ele aparece só quando o cliente decide fechar com um
 * profissional, na tela de aceite da proposta. Ver `Propostas.tsx`.
 *
 * Consequência assumida: sem essas respostas no pedido, o profissional tende a
 * responder propondo VISITA TÉCNICA em vez de preço fechado. É por isso que a
 * proposta tem os dois formatos.
 */
export function montarSteps(jobType: JobType | null, jaTemEquipamento: boolean | null): StepId[] {
  if (!jobType) return ["servico"];
  const fim: StepId[] = ["endereco", "profissional", "confirmar"];
  if (aceitaCatalogo(jobType)) {
    // O catálogo só entra quando o cliente diz que ainda não tem o aparelho.
    // Antes dele, uma pergunta à parte decide se o preço aparece ou não —
    // não é a mesma pergunta de "já tem o aparelho?", é sobre SABER QUAL
    // modelo comprar.
    return [
      "servico", "ambiente", "equipamento",
      ...(jaTemEquipamento === false ? ["aparelho_conhecido" as StepId, "catalogo" as StepId, "carrinho" as StepId] : []),
      ...fim,
    ];
  }
  return ["servico", "detalhes", ...fim];
}
