import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CIDADE } from "@/lib/regiao";
import { EXIGIR_VERIFICACAO } from "@/lib/config";
import { SolicitarWizard } from "./SolicitarWizard";

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
  fotoUrl: string | null; // primeira foto do portfólio, usada como prévia do trabalho
  skills: SkillDTO[];
  destaqueEm: string[]; // especialidades patrocinadas
};

export default async function SolicitarPage(props: PageProps<"/solicitar">) {
  // A home já manda o CEP digitado no hero (?cep=). Sem ler aqui, o cliente
  // precisava digitar de novo lá no passo de endereço.
  const sp = await props.searchParams;
  const cepInicial = typeof sp.cep === "string" ? sp.cep : "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?aviso=" + encodeURIComponent("Entre para solicitar um serviço."));

  // O filtro de verificação é opcional durante o piloto — ver lib/config.
  let qPros = supabase
    .from("professionals")
    .select(
      `id, tipo, bio, cidade, verification_status,
       profiles!inner ( nome, avatar_url ),
       professional_skills ( specialty, rating_avg, rating_count, jobs_completed, years_experience ),
       portfolio_items ( url, media_type, position )`,
    )
    .eq("cidade", CIDADE);
  if (EXIGIR_VERIFICACAO) qPros = qPros.eq("verification_status", "verificado");

  const [{ data: produtos }, { data: pros }, { data: destaques }] = await Promise.all([
    supabase
      .from("products")
      .select("id, marca, modelo, btu, categoria, preco_venda, image_url, supplier")
      .eq("ativo", true)
      .order("btu")
      .order("preco_venda"),
    qPros,
    supabase
      .from("featured_placements")
      .select("professional_id, specialty")
      .eq("cidade", CIDADE)
      .eq("ativo", true),
  ]);

  const destaquePorPro = new Map<string, string[]>();
  for (const d of destaques ?? []) {
    const arr = destaquePorPro.get(d.professional_id) ?? [];
    arr.push(d.specialty);
    destaquePorPro.set(d.professional_id, arr);
  }

  const produtosDTO: ProdutoDTO[] = (produtos ?? []).map((p) => ({
    id: p.id,
    marca: p.marca,
    modelo: p.modelo,
    btu: p.btu,
    categoria: p.categoria,
    precoVenda: Number(p.preco_venda),
    imageUrl: p.image_url,
    distribuidora: p.supplier,
  }));

  const prosDTO: ProfissionalDTO[] = (pros ?? []).map((p) => {
    // profiles pode vir como objeto ou array dependendo da inferência do PostgREST
    const perfil = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
    const fotos = (p.portfolio_items ?? [])
      .filter((i: { media_type: string }) => i.media_type === "foto")
      .sort((a: { position: number }, b: { position: number }) => a.position - b.position);
    return {
      id: p.id,
      tipo: p.tipo as "autonomo" | "empresa",
      nome: perfil?.nome ?? "Profissional",
      bio: p.bio,
      avatarUrl: perfil?.avatar_url ?? null,
      fotoUrl: fotos[0]?.url ?? null,
      skills: (p.professional_skills ?? []).map((s: {
        specialty: string; rating_avg: number; rating_count: number; jobs_completed: number; years_experience: number;
      }) => ({
        specialty: s.specialty,
        ratingAvg: Number(s.rating_avg),
        ratingCount: s.rating_count,
        jobsCompleted: s.jobs_completed,
        yearsExperience: s.years_experience,
      })),
      destaqueEm: destaquePorPro.get(p.id) ?? [],
    };
  });

  return <SolicitarWizard produtos={produtosDTO} profissionais={prosDTO} cepInicial={cepInicial} />;
}
