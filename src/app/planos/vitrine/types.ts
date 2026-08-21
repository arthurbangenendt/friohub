export type PlanoDTO = {
  slug: string;
  nome: string;
  headline: string | null;
  precoMensal: number;
  precoAnual: number | null;
  destaque: boolean;
};
