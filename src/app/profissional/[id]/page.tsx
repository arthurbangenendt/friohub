import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader, SiteFooter } from "@/components/site";
import { Star, Shield, MapPin, Building, User, ArrowRight } from "@/components/icons";

const SPEC_LABEL: Record<string, string> = {
  instalacao: "Instalação", manutencao: "Manutenção", remanejamento: "Remanejamento", limpeza: "Limpeza", conserto: "Conserto",
};
function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}
function Estrelas({ nota, size = 16 }: { nota: number; size?: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} style={{ color: nota >= n - 0.25 ? "var(--warm)" : "var(--ink-faint)", display: "flex" }}>
          <Star size={size} filled={nota >= n - 0.25} />
        </span>
      ))}
    </span>
  );
}

export default async function ProfissionalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: pro } = await supabase
    .from("professionals")
    .select(`id, tipo, razao_social, bio, cidade, estado, verification_status,
             profiles!inner ( nome ),
             professional_skills ( specialty, rating_avg, rating_count, jobs_completed, years_experience ),
             portfolio_items ( id, url, media_type, position ),
             professional_tags ( skill_tags ( slug, label, categoria, ordem ) )`)
    .eq("id", id)
    .maybeSingle();

  if (!pro) notFound();

  const nome = one(pro.profiles)?.nome ?? "Profissional";
  const skills = ((pro.professional_skills ?? []) as { specialty: string; rating_avg: number; rating_count: number; jobs_completed: number; years_experience: number }[])
    .sort((a, b) => b.rating_avg - a.rating_avg);
  const fotos = ((pro.portfolio_items ?? []) as { id: string; url: string; media_type: string; position: number }[])
    .filter((i) => i.media_type === "foto")
    .sort((a, b) => a.position - b.position);
  const verificado = pro.verification_status === "verificado";

  /* Skills detalhadas, agrupadas por categoria. É o que diferencia dois
     profissionais com a mesma nota — quem faz VRF corporativo de quem faz
     split residencial. */
  const tagsPorCategoria = new Map<string, string[]>();
  for (const pt of (pro.professional_tags ?? []) as { skill_tags: unknown }[]) {
    const t = one(pt.skill_tags) as { label: string; categoria: string; ordem: number } | null;
    if (!t) continue;
    const arr = tagsPorCategoria.get(t.categoria) ?? [];
    arr.push(t.label);
    tagsPorCategoria.set(t.categoria, arr);
  }
  const CAT_TITULO: Record<string, string> = {
    servico: "Serviços que executa",
    equipamento: "Equipamentos que domina",
    ambiente: "Ambientes que atende",
    credencial: "Credenciais declaradas",
  };

  const totalReviews = skills.reduce((s, k) => s + k.rating_count, 0);
  const totalJobs = skills.reduce((s, k) => s + k.jobs_completed, 0);
  const notaGeral = totalReviews > 0 ? skills.reduce((s, k) => s + k.rating_avg * k.rating_count, 0) / totalReviews : 0;

  const { data: reviews } = await supabase
    .from("reviews")
    .select(`rating, comment, created_at, specialty, cliente:profiles!reviews_cliente_id_fkey ( nome )`)
    .eq("professional_id", id)
    .order("created_at", { ascending: false })
    .limit(8);

  return (
    <>
      <SiteHeader />
      <main className="container" style={{ padding: "40px 24px 80px", maxWidth: 900 }}>
        <Link href="/solicitar" style={{ fontSize: 13.5, color: "var(--ink-faint)" }}>← Voltar para a busca</Link>

        {/* Cabeçalho */}
        <div style={{ display: "flex", gap: 22, alignItems: "flex-start", margin: "24px 0 8px", flexWrap: "wrap" }}>
          <div style={{ width: 84, height: 84, borderRadius: 20, overflow: "hidden", background: "var(--surface-2)", display: "grid", placeItems: "center", flexShrink: 0, color: "var(--ink-faint)" }}>
            {fotos[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fotos[0].url} alt={nome} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : pro.tipo === "empresa" ? <Building size={34} /> : <User size={34} />}
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 style={{ fontSize: "1.9rem", fontWeight: 800 }}>{nome}</h1>
              {verificado && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, padding: "4px 10px", borderRadius: 100, background: "var(--cool-wash)", color: "var(--cool-deep)" }}>
                  <Shield size={14} /> Verificado
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8, flexWrap: "wrap", color: "var(--ink-soft)", fontSize: 14.5 }}>
              <span>{pro.tipo === "empresa" ? "Empresa" : "Autônomo"}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><MapPin size={15} /> {pro.cidade} — {pro.estado}</span>
              {totalReviews > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Estrelas nota={notaGeral} size={15} /> <strong>{notaGeral.toFixed(1)}</strong>
                  <span style={{ color: "var(--ink-faint)" }}>({totalReviews})</span>
                </span>
              )}
              {totalJobs > 0 && <span style={{ color: "var(--ink-faint)" }}>{totalJobs} serviços concluídos</span>}
            </div>
          </div>
          <Link href="/solicitar" className="btn btn-primary">Solicitar serviço <ArrowRight size={18} /></Link>
        </div>

        {pro.bio && <p style={{ color: "var(--ink-soft)", fontSize: 16, lineHeight: 1.6, maxWidth: 680, marginTop: 14 }}>{pro.bio}</p>}

        {/* Especialidades */}
        <Secao titulo="Especialidades e avaliações">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
            {skills.map((s) => (
              <div key={s.specialty} className="card" style={{ padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <strong style={{ fontSize: 15.5 }}>{SPEC_LABEL[s.specialty] ?? s.specialty}</strong>
                  <span style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>{s.years_experience} anos</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Estrelas nota={s.rating_avg} size={15} />
                  <strong style={{ fontSize: 14 }}>{s.rating_avg.toFixed(1)}</strong>
                  <span style={{ fontSize: 13, color: "var(--ink-faint)" }}>({s.rating_count}) · {s.jobs_completed} serviços</span>
                </div>
              </div>
            ))}
          </div>
        </Secao>

        {tagsPorCategoria.size > 0 && (
          <Secao titulo="O que este profissional faz">
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {["servico", "equipamento", "ambiente", "credencial"].map((cat) => {
                const itens = tagsPorCategoria.get(cat);
                if (!itens?.length) return null;
                return (
                  <div key={cat}>
                    <h3 style={{ fontSize: 12.5, fontWeight: 650, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)", margin: "0 0 10px" }}>
                      {CAT_TITULO[cat] ?? cat}
                    </h3>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {itens.map((label) => (
                        <span key={label} style={{ fontSize: 13.5, padding: "7px 13px", borderRadius: 100, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink-soft)" }}>
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Secao>
        )}

        {/* Portfólio */}
        {fotos.length > 0 && (
          <Secao titulo="Portfólio">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
              {fotos.map((f) => (
                <div key={f.id} style={{ aspectRatio: "4/3", borderRadius: 12, overflow: "hidden", border: "1px solid var(--line)" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt="Trabalho" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
              ))}
            </div>
          </Secao>
        )}

        {/* Avaliações */}
        {reviews && reviews.length > 0 && (
          <Secao titulo="O que os clientes dizem">
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {reviews.map((r, i) => {
                const cli = one(r.cliente)?.nome ?? "Cliente";
                return (
                  <div key={i} className="card" style={{ padding: 18 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: r.comment ? 8 : 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <Estrelas nota={r.rating} size={14} />
                        <span style={{ fontSize: 13.5, color: "var(--ink-faint)" }}>{cli} · {SPEC_LABEL[r.specialty] ?? r.specialty}</span>
                      </div>
                    </div>
                    {r.comment && <p style={{ fontSize: 15, color: "var(--ink-soft)" }}>{r.comment}</p>}
                  </div>
                );
              })}
            </div>
          </Secao>
        )}
      </main>
      <SiteFooter />
    </>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 40 }}>
      <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: 16 }}>{titulo}</h2>
      {children}
    </section>
  );
}
