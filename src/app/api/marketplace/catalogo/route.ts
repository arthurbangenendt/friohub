import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { EXIGIR_VERIFICACAO } from "@/lib/config";
import type {
  PaginaMarketplace,
  ProdutoDTO,
  ProfissionalDTO,
  SkillDTO,
} from "@/app/solicitar/marketplace-types";

const SPECIALTIES = new Set(["instalacao", "manutencao", "remanejamento", "limpeza", "conserto"]);
const SORTS = new Set(["relevancia", "nota", "servicos", "resposta", "disponibilidade"]);
const PAGE_SIZE = 12;

function inteiroLimitado(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function textoBusca(value: string | null) {
  return (value ?? "").trim().slice(0, 80) || null;
}

function coordenadasValidas(latitude: unknown, longitude: unknown) {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
    return null;
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { latitude: lat, longitude: lng };
}

function resposta<T>(body: PaginaMarketplace<T>) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const kind = request.nextUrl.searchParams.get("kind");
  const page = inteiroLimitado(request.nextUrl.searchParams.get("page"), 1, 1, 834);
  const offset = (page - 1) * PAGE_SIZE;
  const query = textoBusca(request.nextUrl.searchParams.get("q"));

  if (kind === "produtos") {
    const btu = inteiroLimitado(request.nextUrl.searchParams.get("btu"), 0, 0, 200000) || null;
    const { data, error } = await supabase.rpc("buscar_produtos_marketplace", {
      p_btu: btu ?? undefined,
      p_query: query ?? undefined,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });
    if (error) return NextResponse.json({ error: "Não foi possível buscar o catálogo." }, { status: 500 });

    const items: ProdutoDTO[] = (data ?? []).map((p) => ({
      id: p.product_id,
      marca: p.marca,
      modelo: p.modelo,
      btu: p.btu,
      categoria: p.categoria,
      precoVenda: Number(p.preco_venda),
      imageUrl: p.image_url,
      distribuidora: p.distribuidora,
    }));
    const total = Number(data?.[0]?.total_count ?? 0);
    return resposta({ items, total, page, hasMore: offset + items.length < total });
  }

  if (kind === "profissionais") {
    const cep = (request.nextUrl.searchParams.get("cep") ?? "").replace(/\D/g, "");
    if (!/^\d{8}$/.test(cep)) {
      return NextResponse.json({ error: "Informe um CEP válido." }, { status: 400 });
    }
    const specialtyParam = request.nextUrl.searchParams.get("specialty");
    const specialty = specialtyParam && SPECIALTIES.has(specialtyParam) ? specialtyParam : null;
    const sortParam = request.nextUrl.searchParams.get("sort") ?? "relevancia";
    const sort = SORTS.has(sortParam) ? sortParam : "relevancia";

    const { data, error } = await supabase.rpc("buscar_profissionais_marketplace", {
      p_cep: cep,
      p_specialty: specialty ?? undefined,
      p_query: query ?? undefined,
      p_sort: sort,
      p_require_verified: EXIGIR_VERIFICACAO,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });
    if (error) return NextResponse.json({ error: "Não foi possível buscar profissionais." }, { status: 500 });

    const items: ProfissionalDTO[] = (data ?? []).map((p) => ({
      id: p.professional_id,
      tipo: p.tipo as "autonomo" | "empresa",
      nome: p.nome,
      bio: p.bio,
      avatarUrl: p.avatar_url,
      fotoUrl: p.foto_url,
      skills: Array.isArray(p.skills) ? p.skills as unknown as SkillDTO[] : [],
      destaqueEm: p.destaque_em ?? [],
      responseRate: Number(p.response_rate),
      activeJobs: p.active_jobs,
      coverageMode: p.coverage_mode === "raio" ? "raio" : "cep",
    }));
    const total = Number(data?.[0]?.total_count ?? 0);
    return resposta({ items, total, page, hasMore: offset + items.length < total });
  }

  return NextResponse.json({ error: "Tipo de catálogo inválido." }, { status: 400 });
}

/** A posição exata viaja no corpo da requisição, nunca na URL ou nos logs de
 * acesso. Este POST é exclusivo da busca territorial de profissionais. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Dados de busca inválidos." }, { status: 400 });
  }

  const cep = String(body.cep ?? "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(cep)) {
    return NextResponse.json({ error: "Informe um CEP válido." }, { status: 400 });
  }

  const recebeuAlgumaCoordenada = body.latitude !== null && body.latitude !== undefined
    || body.longitude !== null && body.longitude !== undefined;
  const coordenadas = coordenadasValidas(body.latitude, body.longitude);
  if (recebeuAlgumaCoordenada && !coordenadas) {
    return NextResponse.json({ error: "Localização inválida." }, { status: 400 });
  }

  const page = inteiroLimitado(String(body.page ?? "1"), 1, 1, 834);
  const offset = (page - 1) * PAGE_SIZE;
  const specialtyValue = typeof body.specialty === "string" ? body.specialty : null;
  const specialty = specialtyValue && SPECIALTIES.has(specialtyValue) ? specialtyValue : null;
  const sortValue = typeof body.sort === "string" ? body.sort : "relevancia";
  const sort = SORTS.has(sortValue) ? sortValue : "relevancia";
  const query = textoBusca(typeof body.q === "string" ? body.q : null);

  const { data, error } = await supabase.rpc("buscar_profissionais_marketplace", {
    p_cep: cep,
    p_specialty: specialty ?? undefined,
    p_query: query ?? undefined,
    p_sort: sort,
    p_require_verified: EXIGIR_VERIFICACAO,
    p_limit: PAGE_SIZE,
    p_offset: offset,
    p_latitude: coordenadas?.latitude,
    p_longitude: coordenadas?.longitude,
  });
  if (error) {
    return NextResponse.json({ error: "Não foi possível buscar profissionais." }, { status: 500 });
  }

  const items: ProfissionalDTO[] = (data ?? []).map((p) => ({
    id: p.professional_id,
    tipo: p.tipo as "autonomo" | "empresa",
    nome: p.nome,
    bio: p.bio,
    avatarUrl: p.avatar_url,
    fotoUrl: p.foto_url,
    skills: Array.isArray(p.skills) ? p.skills as unknown as SkillDTO[] : [],
    destaqueEm: p.destaque_em ?? [],
    responseRate: Number(p.response_rate),
    activeJobs: p.active_jobs,
    coverageMode: p.coverage_mode === "raio" ? "raio" : "cep",
  }));
  const total = Number(data?.[0]?.total_count ?? 0);
  return resposta({ items, total, page, hasMore: offset + items.length < total });
}
