import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CIDADE } from "@/lib/regiao";
import { EXIGIR_VERIFICACAO } from "@/lib/config";
import { PerfilForm } from "./PerfilForm";
import { PortfolioEditor } from "./PortfolioEditor";
import { MidiaEditor } from "../MidiaEditor";
import type { PerfilInput } from "./actions";

export default async function PerfilPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, nome, avatar_url").eq("id", user.id).single();
  if (profile?.role !== "profissional") redirect("/painel");

  const { data: pro } = await supabase
    .from("professionals")
    .select(`tipo, razao_social, bio, cidade, anos_experiencia, verification_status, banner_url,
             professional_skills ( specialty, years_experience ),
             service_areas ( cep_prefix ),
             professional_tags ( tag_slug )`)
    .eq("id", user.id)
    .maybeSingle();

  // Catálogo das skills detalhadas que o profissional pode marcar.
  const { data: catalogo } = await supabase
    .from("skill_tags")
    .select("slug, label, categoria")
    .eq("ativo", true)
    .order("categoria")
    .order("ordem");

  const { data: portfolio } = await supabase
    .from("portfolio_items")
    .select("id, url, grupo_id, momento, caption, position")
    .eq("professional_id", user.id)
    .eq("media_type", "foto")
    .order("position");

  const inicial: PerfilInput = {
    tipo: (pro?.tipo as "autonomo" | "empresa") ?? "autonomo",
    razaoSocial: pro?.razao_social ?? "",
    bio: pro?.bio ?? "",
    // Padrão é a praça atendida (São Paulo). Antes era Fortaleza / CEP 60 — sobra
    // de outra operação, que deixava o profissional fora de toda busca.
    cidade: pro?.cidade ?? CIDADE,
    cepPrefix: (pro?.service_areas?.[0]?.cep_prefix as string) ?? "01",
    anosExperiencia: pro?.anos_experiencia ?? 0,
    skills: (pro?.professional_skills ?? []).map((s: { specialty: string; years_experience: number }) => ({
      specialty: s.specialty, years: s.years_experience,
    })),
    tags: (pro?.professional_tags ?? []).map((t: { tag_slug: string }) => t.tag_slug),
  };

  const verificado = pro?.verification_status === "verificado";

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: "0 0 6px" }}>Meu perfil profissional</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 8 }}>
        É isso que os clientes veem ao escolher um profissional. Capriche.
      </p>
      {pro && (
        <Link href={`/profissional/${user.id}`} style={{ fontSize: 13.5, fontWeight: 600, color: "var(--cool-deep)" }}>
          Ver meu perfil como o cliente vê →
        </Link>
      )}
      {pro && (
        <p style={{ fontSize: 13.5, color: verificado || !EXIGIR_VERIFICACAO ? "var(--good)" : "var(--warm)", marginBottom: 26, fontWeight: 600 }}>
          {verificado
            ? "Perfil verificado — visível nas buscas."
            : EXIGIR_VERIFICACAO
              ? "Perfil em análise — ainda não aparece nas buscas."
              : "Perfil ativo — você já aparece nas buscas dos clientes."}
        </p>
      )}
      <div className="card" style={{ padding: 26, marginTop: 8 }}>
        <MidiaEditor uid={user.id} nome={profile?.nome ?? "Profissional"}
          avatarUrl={profile?.avatar_url ?? null} bannerUrl={pro?.banner_url ?? null}
          mostrarBanner bannerHabilitado={!!pro} />
      </div>

      <div className="card" style={{ padding: 26, marginTop: 16 }}>
        <PerfilForm inicial={inicial} catalogo={catalogo ?? []} />
      </div>

      <div className="card" style={{ padding: 26, marginTop: 16 }}>
        <div style={{ fontSize: 12.5, fontWeight: 650, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)", marginBottom: 4 }}>Portfólio</div>
        <p style={{ color: "var(--ink-soft)", fontSize: 14, marginBottom: 16 }}>Mostre o antes e o depois dos serviços que você já fez.</p>
        {pro ? (
          <PortfolioEditor uid={user.id} inicial={portfolio ?? []} />
        ) : (
          <p style={{ color: "var(--ink-faint)", fontSize: 14 }}>Salve seu perfil acima primeiro para liberar o envio de fotos.</p>
        )}
      </div>
    </main>
  );
}
