import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader, SiteFooter } from "@/components/site";
import { TimelineContent } from "@/components/ui/timeline-animation";
import { VerticalCutReveal } from "@/components/ui/vertical-cut-reveal";
import { Avatar } from "@/app/painel/Avatar";
import { Star, Shield, MapPin, Building, User, ArrowRight, Chat, Check } from "@/components/icons";
import { one } from "@/lib/relacional";
import { BotaoMensagem } from "./BotaoMensagem";

const SPEC_LABEL: Record<string, string> = {
  instalacao: "Instalação",
  manutencao: "Manutenção",
  remanejamento: "Remanejamento",
  limpeza: "Limpeza",
  conserto: "Conserto",
};

const CAT_TITULO: Record<string, string> = {
  servico: "Serviços",
  equipamento: "Equipamentos",
  ambiente: "Ambientes atendidos",
  credencial: "Credenciais declaradas",
};

function Estrelas({ nota, size = 16 }: { nota: number; size?: number }) {
  return (
    <span className="perfil-estrelas" aria-label={`${nota.toFixed(1)} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={nota >= n - .25 ? "perfil-estrela-on" : "perfil-estrela-off"}>
          <Star size={size} filled={nota >= n - .25} aria-hidden="true" />
        </span>
      ))}
    </span>
  );
}

type FotoRow = {
  id: string;
  url: string;
  media_type: string;
  position: number;
  grupo_id: string | null;
  momento: string | null;
  caption: string | null;
};

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
  const nomePessoa = perfil?.nome ?? "Profissional";
  const nome = pro.tipo === "empresa" && pro.razao_social ? pro.razao_social : nomePessoa;
  const avatarUrl = perfil?.avatar_url ?? null;
  const skills = ((pro.professional_skills ?? []) as {
    specialty: string;
    rating_avg: number;
    rating_count: number;
    jobs_completed: number;
    years_experience: number;
  }[]).sort((a, b) => b.rating_avg - a.rating_avg);

  const fotos = ((pro.portfolio_items ?? []) as FotoRow[])
    .filter((item) => item.media_type === "foto")
    .sort((a, b) => a.position - b.position);

  const paresPortfolio = (() => {
    const mapa = new Map<string, { antes: FotoRow | null; depois: FotoRow | null; caption: string | null }>();
    for (const foto of fotos) {
      const chave = foto.grupo_id ?? `avulsa-${foto.id}`;
      const par = mapa.get(chave) ?? { antes: null, depois: null, caption: null };
      if (foto.momento === "antes") par.antes = foto;
      else par.depois = foto;
      if (foto.caption) par.caption = foto.caption;
      mapa.set(chave, par);
    }
    return [...mapa.entries()].map(([chave, par]) => ({ chave, ...par }));
  })();

  const tagsPorCategoria = new Map<string, string[]>();
  for (const professionalTag of (pro.professional_tags ?? []) as { skill_tags: unknown }[]) {
    const tag = one(professionalTag.skill_tags) as { label: string; categoria: string; ordem: number } | null;
    if (!tag) continue;
    const itens = tagsPorCategoria.get(tag.categoria) ?? [];
    itens.push(tag.label);
    tagsPorCategoria.set(tag.categoria, itens);
  }

  const totalReviews = skills.reduce((total, skill) => total + skill.rating_count, 0);
  const totalJobs = skills.reduce((total, skill) => total + skill.jobs_completed, 0);
  const notaGeral = totalReviews > 0
    ? skills.reduce((total, skill) => total + skill.rating_avg * skill.rating_count, 0) / totalReviews
    : 0;
  const verificado = pro.verification_status === "verificado";

  const { data: reviews } = await supabase
    .from("reviews")
    .select(`rating, comment, created_at, specialty, cliente:profiles!reviews_cliente_id_fkey ( nome )`)
    .eq("professional_id", id)
    .order("created_at", { ascending: false })
    .limit(8);

  const temPortfolio = paresPortfolio.length > 0;
  const temReviews = !!reviews?.length;

  return (
    <>
      <SiteHeader logado={!!usuario} />
      <main id="conteudo" className="perfil-publico">
        <div className="container perfil-voltar-wrap">
          <Link href="/solicitar" className="perfil-voltar">← Voltar para a busca</Link>
        </div>

        <section className="container perfil-hero" aria-labelledby="perfil-nome">
          <TimelineContent>
            <div className="perfil-capa-nova">
              {pro.banner_url ? (
                // A origem muda por ambiente; manter img evita uma allowlist frágil no next.config.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pro.banner_url} alt={`Capa do perfil de ${nome}`} />
              ) : (
                <div className="perfil-capa-vazia" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              )}
              <div className="perfil-capa-scrim" />
              <div className="perfil-capa-label">
                <span className="perfil-capa-asterisco" aria-hidden="true">✦</span>
                Profissional FrioHub
              </div>
              {verificado && (
                <span className="perfil-selo perfil-selo-capa"><Shield size={15} /> Perfil verificado</span>
              )}
            </div>
          </TimelineContent>

          <div className="perfil-apresentacao">
            <TimelineContent className="perfil-identidade" delay={.08}>
              <span className="perfil-foto perfil-foto-nova">
                <Avatar nome={nome} id={pro.id} url={avatarUrl} size={116} radius="26px" fontSize={40} />
              </span>
              <div className="perfil-identidade-texto">
                <span className="perfil-tipo">
                  {pro.tipo === "empresa" ? <Building size={15} /> : <User size={15} />}
                  {pro.tipo === "empresa" ? "Empresa especializada" : "Profissional autônomo"}
                </span>
                <h1 id="perfil-nome" className="perfil-nome">
                  <VerticalCutReveal>{nome}</VerticalCutReveal>
                </h1>
                {pro.tipo === "empresa" && nomePessoa !== nome && (
                  <p className="perfil-responsavel">Responsável: {nomePessoa}</p>
                )}
                <p className="perfil-local"><MapPin size={17} /> {pro.cidade} — {pro.estado}</p>
              </div>
            </TimelineContent>

            <TimelineContent className="perfil-acoes-topo" delay={.16}>
              {usuario && usuario.id !== pro.id && <BotaoMensagem professionalId={pro.id} />}
              <Link href="/solicitar" className="btn btn-primary btn-lg perfil-cta-topo">
                Solicitar serviço <ArrowRight size={18} />
              </Link>
            </TimelineContent>
          </div>

          <TimelineContent className="perfil-metricas" delay={.2}>
            <div className="perfil-metrica">
              <strong>{(pro.anos_experiencia ?? 0) > 0 ? `${pro.anos_experiencia}+` : "Novo"}</strong>
              <span>{pro.anos_experiencia === 1 ? "ano de experiência" : "anos de experiência"}</span>
            </div>
            <div className="perfil-metrica">
              <strong>{totalJobs || "—"}</strong>
              <span>{totalJobs === 1 ? "serviço concluído" : "serviços concluídos"}</span>
            </div>
            <div className="perfil-metrica perfil-metrica-nota">
              <strong>{totalReviews ? notaGeral.toFixed(1) : "—"}</strong>
              <span>{totalReviews ? <><Estrelas nota={notaGeral} size={14} /> {totalReviews} avaliações</> : "ainda sem avaliações"}</span>
            </div>
          </TimelineContent>

          <nav className="perfil-nav" aria-label="Navegação do perfil">
            <a href="#sobre">Sobre</a>
            <a href="#especialidades">Especialidades</a>
            {temPortfolio && <a href="#portfolio">Portfólio</a>}
            {temReviews && <a href="#avaliacoes">Avaliações</a>}
          </nav>
        </section>

        <div className="container perfil-conteudo-grid">
          <div className="perfil-coluna-principal">
            <TimelineContent>
              <Secao id="sobre" marcador="Quem vai atender você" titulo="Experiência que inspira confiança">
                <p className="perfil-bio">
                  {pro.bio || `${nome} atende projetos de climatização em ${pro.cidade}, com foco em um serviço claro, cuidadoso e bem executado.`}
                </p>
              </Secao>
            </TimelineContent>

            {skills.length > 0 && (
              <TimelineContent>
                <Secao id="especialidades" marcador="Conhecimento técnico" titulo="Especialidades e experiência">
                  <div className="perfil-skills-grade">
                    {skills.map((skill) => (
                      <article key={skill.specialty} className="perfil-skill-card">
                        <div className="perfil-skill-icone"><Check size={18} /></div>
                        <div className="perfil-skill-corpo">
                          <div className="perfil-skill-titulo">
                            <h3>{SPEC_LABEL[skill.specialty] ?? skill.specialty}</h3>
                            <span>{skill.years_experience} {skill.years_experience === 1 ? "ano" : "anos"}</span>
                          </div>
                          {skill.rating_count > 0 ? (
                            <div className="perfil-skill-nota">
                              <Estrelas nota={skill.rating_avg} size={14} />
                              <strong>{skill.rating_avg.toFixed(1)}</strong>
                              <span>({skill.rating_count}) · {skill.jobs_completed} serviços</span>
                            </div>
                          ) : (
                            <p className="perfil-skill-novo">Especialidade adicionada recentemente</p>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </Secao>
              </TimelineContent>
            )}

            {tagsPorCategoria.size > 0 && (
              <TimelineContent>
                <Secao marcador="Atuação detalhada" titulo="O que este profissional faz">
                  <div className="perfil-tags-grupos">
                    {["servico", "equipamento", "ambiente", "credencial"].map((categoria) => {
                      const itens = tagsPorCategoria.get(categoria);
                      if (!itens?.length) return null;
                      return (
                        <div className="perfil-tags-grupo" key={categoria}>
                          <h3>{CAT_TITULO[categoria] ?? categoria}</h3>
                          <div className="perfil-tags">
                            {itens.map((label) => <span key={label}>{label}</span>)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Secao>
              </TimelineContent>
            )}

            {temPortfolio && (
              <TimelineContent>
                <Secao id="portfolio" marcador="Resultados reais" titulo="Trabalhos realizados">
                  <div className="pf-grade perfil-portfolio-grade">
                    {paresPortfolio.map((par) => (
                      <figure key={par.chave} className="pf-par perfil-portfolio-card">
                        <div className="pf-fotos">
                          {par.antes && (
                            <span className="pf-foto">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={par.antes.url} alt={`Antes${par.caption ? `: ${par.caption}` : " do serviço"}`} />
                              <span className="pf-tag">Antes</span>
                            </span>
                          )}
                          {par.depois && (
                            <span className="pf-foto">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={par.depois.url} alt={`Depois${par.caption ? `: ${par.caption}` : " do serviço"}`} />
                              <span className="pf-tag pf-tag-depois">Depois</span>
                            </span>
                          )}
                        </div>
                        {par.caption && <figcaption className="pf-legenda">{par.caption}</figcaption>}
                      </figure>
                    ))}
                  </div>
                </Secao>
              </TimelineContent>
            )}

            {temReviews && (
              <TimelineContent>
                <Secao id="avaliacoes" marcador="Reputação na plataforma" titulo="O que os clientes dizem">
                  <div className="perfil-reviews">
                    {reviews.map((review, indice) => {
                      const cliente = one(review.cliente)?.nome ?? "Cliente";
                      return (
                        <article key={`${review.created_at}-${indice}`} className="perfil-review-card">
                          <div className="perfil-review-topo">
                            <div>
                              <strong>{cliente}</strong>
                              <span>{SPEC_LABEL[review.specialty] ?? review.specialty}</span>
                            </div>
                            <Estrelas nota={review.rating} size={15} />
                          </div>
                          {review.comment && <blockquote>“{review.comment}”</blockquote>}
                          <time dateTime={review.created_at}>
                            {new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(review.created_at))}
                          </time>
                        </article>
                      );
                    })}
                  </div>
                </Secao>
              </TimelineContent>
            )}
          </div>

          <aside className="perfil-aside" aria-label="Contratar profissional">
            <TimelineContent>
              <div className="perfil-contato-card">
                <span className="perfil-contato-icone"><Chat size={22} /></span>
                <p className="perfil-contato-kicker">Pronto para começar?</p>
                <h2>Converse sobre seu serviço</h2>
                <p>Conte o que precisa e receba uma proposta com escopo, prazo e valor.</p>
                <Link href="/solicitar" className="btn btn-primary btn-block">
                  Solicitar orçamento <ArrowRight size={18} />
                </Link>
                {usuario && usuario.id !== pro.id && <BotaoMensagem professionalId={pro.id} />}
                <span className="perfil-contato-seguranca"><Shield size={15} /> Seus dados ficam protegidos</span>
              </div>
            </TimelineContent>
          </aside>
        </div>

        <div className="perfil-cta-mobile">
          <Link href="/solicitar" className="btn btn-primary btn-block">Solicitar serviço <ArrowRight size={18} /></Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function Secao({
  id,
  marcador,
  titulo,
  children,
}: {
  id?: string;
  marcador: string;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="perfil-secao">
      <p className="perfil-secao-marcador"><span aria-hidden="true">✦</span>{marcador}</p>
      <h2>{titulo}</h2>
      {children}
    </section>
  );
}
