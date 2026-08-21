import type { ProdutoDTO } from "../marketplace-types";

/* Um cômodo a climatizar. Cada um tem a própria carga térmica e o próprio
   aparelho: 9k na suíte e 18k na sala é o caso normal, não a exceção. */
export type AmbienteForm = {
  /** Chave estável de lista — o nome muda enquanto o cliente digita. */
  chave: string;
  nome: string;
  areaM2: number;
  numPessoas: number;
  eletronicos: number;
  insolacaoAlta: boolean;
  andarOuTelhado: boolean;
  quantidade: number;
  produtoId: string | null;
  produto: ProdutoDTO | null;
};

/* Passos são declarados por id, não por número. Com sete tipos de serviço e
   ramificações diferentes, indexar passo por `step === 3 && equip` é onde o bug
   nasce — aqui a lista é montada e a navegação anda sobre ela. */
export type StepId = "servico" | "ambiente" | "detalhes" | "equipamento" | "aparelho_conhecido" | "catalogo" | "carrinho" | "profissional" | "endereco" | "confirmar";

export type GeoState = {
  status: "pedindo" | "coordenadas" | "ok" | "negado" | "erro" | "indisponivel" | "idle";
  cidade?: string;
  uf?: string;
  cep?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number | null;
};

export type CoordenadasServico = { latitude: number; longitude: number };
