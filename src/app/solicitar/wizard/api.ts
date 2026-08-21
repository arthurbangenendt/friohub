import type { PaginaMarketplace, ProfissionalDTO } from "../marketplace-types";
import type { CoordenadasServico } from "./types";

export async function carregarPagina<T>(params: URLSearchParams, signal?: AbortSignal) {
  const response = await fetch(`/api/marketplace/catalogo?${params}`, { signal });
  const body = await response.json() as PaginaMarketplace<T> | { error?: string };
  if (!response.ok || !("items" in body)) {
    throw new Error("error" in body && body.error ? body.error : "Não foi possível carregar os resultados.");
  }
  return body;
}

export async function carregarProfissionaisPagina(
  input: {
    page: number;
    cep: string;
    specialty: string | null;
    sort: string;
    q: string;
    coordenadas: CoordenadasServico | null;
  },
  signal?: AbortSignal,
) {
  const response = await fetch("/api/marketplace/catalogo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      page: input.page,
      cep: input.cep,
      specialty: input.specialty,
      sort: input.sort,
      q: input.q,
      latitude: input.coordenadas?.latitude,
      longitude: input.coordenadas?.longitude,
    }),
    signal,
  });
  const body = await response.json() as PaginaMarketplace<ProfissionalDTO> | { error?: string };
  if (!response.ok || !("items" in body)) {
    throw new Error("error" in body && body.error ? body.error : "Não foi possível carregar os profissionais.");
  }
  return body;
}
