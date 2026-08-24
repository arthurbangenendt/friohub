import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CIDADE } from "@/lib/regiao";
import { EXIGIR_VERIFICACAO } from "@/lib/config";
import { PerfilForm } from "./PerfilForm";
import { PortfolioEditor } from "./PortfolioEditor";
import { MidiaEditor } from "../MidiaEditor";
import { MinhaAssinatura, type AssinaturaDTO } from "./MinhaAssinatura";
import { ChavePix } from "./ChavePix";
import { DocumentoVerificacao } from "./DocumentoVerificacao";
import type { PerfilInput, TipoChavePix } from "./actions";

export default async function PerfilPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, nome, avatar_url").eq("id", user.id).single();
  if (profile?.role !== "profissional") redirect("/painel");

  const { data: pro } = await supabase
    .from("professionals")
    .select(`tipo, razao_social, bio, cidade, anos_experiencia, verification_status, banner_url,
             documento_tipo, documento_storage_path, documento_enviado_em,
             professional_skills ( specialty, years_experience ),
             service_areas ( cep_prefix ),
             professional_tags ( tag_slug )`)
    .eq("id", user.id)
    .maybeSingle();

  // Esta tabela é privada por RLS: só o próprio profissional recebe as
  // coordenadas usadas para editar o raio. Ela não entra na vitrine pública.
  const { data: serviceRadius } = await supabase
    .from("professional_service_radius")
    .select("latitude, longitude, radius_km, location_label, accuracy_m")
    .eq("professional_id", user.id)
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

  const { data: chavePixRows } = await supabase.rpc("minha_chave_pix");
  const chavePixRow = Array.isArray(chavePixRows) ? chavePixRows[0] : null;
  const chavePix = chavePixRow?.chave_pix && chavePixRow?.chave_pix_tipo
    ? { chavePix: chavePixRow.chave_pix, chavePixTipo: chavePixRow.chave_pix_tipo as TipoChavePix }
    : null;

  const { data: assinaturaRows } = await supabase.rpc("minha_assinatura_atual");
  const assinaturaRow = Array.isArray(assinaturaRows) ? assinaturaRows[0] : null;
  const assinatura: AssinaturaDTO | null = assinaturaRow
    ? {
        planoNome: assinaturaRow.plano_nome,
        ciclo: assinaturaRow.ciclo as "mensal" | "anual",
        valor: Number(assinaturaRow.valor),
        status: assinaturaRow.status as AssinaturaDTO["status"],
        autoRenova: assinaturaRow.auto_renova,
        proximoVencimento: assinaturaRow.next_due_date,
      }
    : null;

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
    serviceRadius: serviceRadius ? {
      latitude: serviceRadius.latitude,
      longitude: serviceRadius.longitude,
      radiusKm: serviceRadius.radius_km,
      locationLabel: serviceRadius.location_label,
      accuracyM: serviceRadius.accuracy_m,
    } : null,
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

      {pro && (
        <div className="card" style={{ padding: 26, marginTop: 16 }}>
          <DocumentoVerificacao
            status={pro.verification_status as "pendente" | "em_analise" | "verificado" | "rejeitado"}
            tipoEnviado={pro.documento_tipo as "cnh" | "rg" | "crea_cft" | "cartao_cnpj" | null}
            enviadoEm={pro.documento_enviado_em}
          />
        </div>
      )}

      {pro && <MinhaAssinatura assinatura={assinatura} />}
      {pro && <ChavePix inicial={chavePix} />}

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
