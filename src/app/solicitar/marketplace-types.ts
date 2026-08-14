export type ProdutoDTO = {
  id: string;
  marca: string;
  modelo: string;
  btu: number;
  categoria: string;
  precoVenda: number;
  imageUrl: string | null;
  distribuidora: string | null;
};

export type SkillDTO = {
  specialty: string;
  ratingAvg: number;
  ratingCount: number;
  jobsCompleted: number;
  yearsExperience: number;
};

export type ProfissionalDTO = {
  id: string;
  tipo: "autonomo" | "empresa";
  nome: string;
  bio: string | null;
  avatarUrl: string | null;
  fotoUrl: string | null;
  skills: SkillDTO[];
  destaqueEm: string[];
  responseRate: number;
  activeJobs: number;
  coverageMode?: "raio" | "cep";
};

export type PaginaMarketplace<T> = {
  items: T[];
  total: number;
  page: number;
  hasMore: boolean;
};
