import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader, SiteFooter } from "@/components/site";
import { Avatar } from "@/app/painel/Avatar";
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
    .select(`id, tipo, razao_social, bio, cidade, estado, verification_status, banner_url, anos_experiencia,
             profiles!inner ( nome, avatar_url ),
             professional_skills ( specialty, rating_avg, rating_count, jobs_completed, years_experience ),
             portfolio_items ( id, url, media_type, position, grupo_id, momento, caption ),
             professional_tags ( skill_tags ( slug, label, categoria, ordem ) )`)
    .eq("id", id)
    .maybeSingle();

  if (!pro) notFound();

  const { data: { user: usuario } } = await supabase.auth.getUser();

  const perfil = one(pro.profiles) as { nome: string; avatar_url: string | null } | null;
  const nome = perfil?.nome ?? "Profissional";
  const avatarUrl = perfil?.avatar_url ?? null;
  const skills = ((pro.professional_skills ?? []) as { specialty: string; rating_avg: number; rating_count: number; jobs_completed: number; years_experience: number }[])
    .sort((a, b) => b.rating_avg - a.rating_avg);
  type FotoRow = { id: string; url: string; media_type: string; position: number; grupo_id: string | null; momento: string | null; caption: string | null };
  const fotos = ((pro.portfolio_items ?? []) as FotoRow[])
    .filter((i) => i.media_type === "foto")
    .sort((a, b) => a.position - b.position);

  /* Agrupa em pares antes/depois. Foto sem grupo (avulsa) vira um par só com
     "depois", para continuar aparecendo em vez de sumir da vitrine. */
  const paresPortfolio = (() => {
    const mapa = new Map<string, { antes: FotoRow | null; depois: FotoRow | null; caption: string | null }>();
    for (const f of fotos) {
      const chave = f.grupo_id ?? `avulsa-${f.id}`;
      const par = mapa.get(chave) ?? { antes: null, depois: null, caption: null };
      if (f.momento === "antes") par.antes = f; else par.depois = f;
      if (f.caption) par.caption = f.caption;
      mapa.set(chave, par);
    }
    return [...mapa.entries()].map(([chave, par]) => ({ chave, ...par }));
  })();
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
      <SiteHeader logado={!!usuario} />
      <main className="container" style={{ padding: "40px 24px 80px", maxWidth: 900 }}>
        <Link href="/solicitar" style={{ fontSize: 13.5, color: "var(--ink-faint)" }}>← Voltar para a busca</Link>

        {/* Capa: banner do parceiro, com degradê da marca quando não há imagem */}
        <div className="perfil-capa" style={{ marginTop: 20 }}>
          {pro.banner_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pro.banner_url} alt="" />
          )}
        </div>

        {/* Identificação, sobreposta à capa */}
        <div className="perfil-topo">
          <span className="perfil-foto">
            <Avatar nome={nome} id={pro.id} url={avatarUrl} size={104} radius="22px" fontSize={36} />
          </span>

          <div className="perfil-id">
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 style={{ fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-0.025em" }}>{nome}</h1>
              {verificado && <span className="perfil-selo"><Shield size={14} /> Verificado</span>}
            </div>
            <div className="perfil-meta">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                {pro.tipo === "empresa" ? <Building size={15} /> : <User size={15} />}
                {pro.tipo === "empresa" ? "Empresa" : "Autônomo"}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><MapPin size={15} /> {pro.cidade} — {pro.estado}</span>
              {(pro.anos_experiencia ?? 0) > 0 && (
                <span style={{ color: "var(--ink-faint)" }}>
                  {pro.anos_experiencia} {pro.anos_experiencia === 1 ? "ano" : "anos"} de experiência
                </span>
              )}
              {totalReviews > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Estrelas nota={notaGeral} size={15} /> <strong>{notaGeral.toFixed(1)}</strong>
                  <span style={{ color: "var(--ink-faint)" }}>({totalReviews})</span>
                </span>
              )}
              {totalJobs > 0 && <span style={{ color: "var(--ink-faint)" }}>{totalJobs} serviços concluídos</span>}
            </div>
          </div>

          <Link href="/solicitar" className="btn btn-primary" style={{ flexShrink: 0 }}>
            Solicitar serviço <ArrowRight size={18} />
          </Link>
        </div>

        {pro.bio && <p style={{ color: "var(--ink-soft)", fontSize: 16, lineHeight: 1.6, maxWidth: 680, marginTop: 20 }}>{pro.bio}</p>}

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

        {/* Portfólio: antes e depois lado a lado */}
        {paresPortfolio.length > 0 && (
          <Secao titulo="Trabalhos realizados">
            <div className="pf-grade">
              {paresPortfolio.map((par) => (
                <figure key={par.chave} className="pf-par">
                  <div className="pf-fotos">
                    {par.antes && (
                      <span className="pf-foto">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={par.antes.url} alt="Antes do serviço" />
                        <span className="pf-tag">Antes</span>
                      </span>
                    )}
                    {par.depois && (
                      <span className="pf-foto">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={par.depois.url} alt="Depois do serviço" />
                        <span className="pf-tag pf-tag-depois">Depois</span>
                      </span>
                    )}
                  </div>
                  {par.caption && <figcaption className="pf-legenda">{par.caption}</figcaption>}
                </figure>
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
