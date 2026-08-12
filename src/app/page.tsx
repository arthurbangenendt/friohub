import Link from "next/link";
import type { CSSProperties } from "react";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader, SiteFooter } from "@/components/site";
import { Wind, Wrench, Droplet, Move, Tool, ArrowRight, Star, Shield, Bolt, Check } from "@/components/icons";
import { Hero } from "@/components/ui/hero";

const SERVICOS = [
  { Icon: Wind, titulo: "Instalação", desc: "Aparelho novo da distribuidora, instalado por quem entende." },
  { Icon: Wrench, titulo: "Manutenção", desc: "Revisão, recarga de gás e reparos preventivos." },
  { Icon: Droplet, titulo: "Limpeza", desc: "Higienização completa para um ar mais saudável." },
  { Icon: Move, titulo: "Remanejamento", desc: "Mudou de casa ou de parede? A gente reposiciona." },
  { Icon: Tool, titulo: "Conserto", desc: "Diagnóstico e reparo de defeitos com garantia." },
];

const PASSOS = [
  { n: "01", titulo: "Diga o que precisa", desc: "Instalação, manutenção, limpeza — em menos de um minuto, com o CEP da sua casa." },
  { n: "02", titulo: "Receba a recomendação", desc: "Nossa calculadora indica a capacidade ideal em BTU e mostra os aparelhos certos." },
  { n: "03", titulo: "Escolha o profissional", desc: "Compare por avaliação, especialidade e experiência. Você decide com quem fechar." },
];

const SPEC_LABEL: Record<string, string> = {
  instalacao: "Instalação", manutencao: "Manutenção", remanejamento: "Remanejamento", limpeza: "Limpeza", conserto: "Conserto",
};

export default async function Home() {
  const supabase = await createClient();

  const [{ data: pros }, { count: numProdutos }] = await Promise.all([
    supabase
      .from("professionals")
      .select(`id, tipo, bio, profiles!inner ( nome ), professional_skills ( specialty, rating_avg, rating_count, jobs_completed )`)
      .eq("cidade", "São Paulo")
      .eq("verification_status", "verificado")
      .limit(6),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("ativo", true),
  ]);

  const destaques = (pros ?? [])
    .map((p) => {
      const perfil = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
      const skills = (p.professional_skills ?? []) as { specialty: string; rating_avg: number; rating_count: number; jobs_completed: number }[];
      const top = [...skills].sort((a, b) => b.rating_avg - a.rating_avg)[0];
      return top ? { id: p.id, nome: perfil?.nome ?? "Profissional", tipo: p.tipo as string, top } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (b!.top.rating_avg - a!.top.rating_avg))
    .slice(0, 4) as { id: string; nome: string; tipo: string; top: { specialty: string; rating_avg: number; rating_count: number; jobs_completed: number } }[];

  const numPros = (pros ?? []).length;

  return (
    <>
      <SiteHeader overHero />

      {/* ---------------- HERO ---------------- */}
      <Hero />

      {/* barra de marcas */}
      <div style={{ borderBottom: "1px solid var(--line)", background: "var(--bg-subtle)" }}>
        <div className="container" style={{ display: "flex", alignItems: "center", gap: 28, padding: "18px 24px", flexWrap: "wrap", justifyContent: "center" }}>
          <span style={{ fontSize: 13, color: "var(--ink-faint)", fontWeight: 600 }}>Aparelhos de</span>
          {["Samsung", "LG", "Fujitsu", "Midea", "Gree", "Elgin", "TCL", "Hitachi"].map((m) => (
            <span key={m} style={{ fontSize: 16, fontWeight: 700, color: "var(--ink-faint)", letterSpacing: "-0.01em" }}>{m}</span>
          ))}
        </div>
      </div>

      {/* ---------------- COMO FUNCIONA ---------------- */}
      <section id="como-funciona" style={{ padding: "84px 0" }}>
        <div className="container">
          <SectionHead eyebrow="Como funciona" titulo="Do calor ao conforto em três passos" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 24, marginTop: 44 }}>
            {PASSOS.map((p) => (
              <div key={p.n}>
                <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: 14, fontWeight: 600, color: "var(--cool)", marginBottom: 14 }}>{p.n}</div>
                <h3 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: 8 }}>{p.titulo}</h3>
                <p style={{ color: "var(--ink-soft)", fontSize: 15.5, lineHeight: 1.6 }}>{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- SERVIÇOS ---------------- */}
      <section id="servicos" style={{ padding: "84px 0", background: "var(--bg-subtle)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
        <div className="container">
          <SectionHead eyebrow="Serviços" titulo="Tudo o que o seu ar precisa" sub="De instalação nova a manutenção — com profissionais especializados em cada tipo." />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 18, marginTop: 44 }}>
            {SERVICOS.map(({ Icon, titulo, desc }) => (
              <div key={titulo} className="card" style={{ padding: 24 }}>
                <span style={{ display: "grid", placeItems: "center", width: 44, height: 44, borderRadius: 11, background: "var(--cool-wash)", color: "var(--cool-deep)", marginBottom: 16 }}>
                  <Icon size={22} />
                </span>
                <h3 style={{ fontSize: "1.12rem", fontWeight: 700, marginBottom: 6 }}>{titulo}</h3>
                <p style={{ color: "var(--ink-soft)", fontSize: 14.5, lineHeight: 1.55 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- PROFISSIONAIS EM DESTAQUE ---------------- */}
      {destaques.length > 0 && (
        <section style={{ padding: "84px 0" }}>
          <div className="container">
            <SectionHead eyebrow="Profissionais" titulo="Gente de verdade, avaliada de verdade" sub={`${numPros} profissionais verificados atendendo São Paulo.`} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 18, marginTop: 44 }}>
              {destaques.map((d) => (
                <div key={d.id} className="card" style={{ padding: 22 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                    <span style={{ display: "grid", placeItems: "center", width: 46, height: 46, borderRadius: "50%", background: "var(--surface-2)", color: "var(--ink-soft)", fontWeight: 700, fontSize: 17 }}>
                      {d.nome.charAt(0)}
                    </span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15.5 }}>{d.nome}</div>
                      <div style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>{d.tipo === "empresa" ? "Empresa" : "Autônomo"}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, marginBottom: 10 }}>
                    <span style={{ color: "var(--warm)", display: "flex" }}><Star size={15} filled /></span>
                    <strong>{d.top.rating_avg.toFixed(1)}</strong>
                    <span style={{ color: "var(--ink-faint)" }}>· {d.top.jobs_completed} serviços</span>
                  </div>
                  <span style={{ display: "inline-block", fontSize: 12.5, fontWeight: 600, padding: "4px 10px", borderRadius: 100, background: "var(--cool-wash)", color: "var(--cool-deep)" }}>
                    {SPEC_LABEL[d.top.specialty] ?? d.top.specialty}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ---------------- POR QUE ---------------- */}
      <section style={{ padding: "84px 0", background: "var(--bg-subtle)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
        <div className="container">
          <SectionHead eyebrow="Por que o FrioHub" titulo="Confiança em cada etapa" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 22, marginTop: 44 }}>
            <Valor Icon={Shield} titulo="Profissionais verificados" desc="Cada instalador e empresa passa por checagem antes de atender você." />
            <Valor Icon={Star} titulo="Avaliação por especialidade" desc="A nota em instalação é separada da nota em manutenção. Transparência real." />
            <Valor Icon={Bolt} titulo="Preço direto da distribuidora" desc="O aparelho vem do nosso catálogo, sem intermediário encarecendo." />
            <Valor Icon={Check} titulo="Você no controle" desc="Compara, escolhe o profissional e acompanha tudo pelo painel." />
          </div>
        </div>
      </section>

      {/* ---------------- FAQ ---------------- */}
      <section style={{ padding: "84px 0" }}>
        <div className="container-tight">
          <SectionHead eyebrow="Dúvidas" titulo="Perguntas frequentes" />
          <div style={{ marginTop: 36, display: "flex", flexDirection: "column", gap: 4 }}>
            <Faq q="Quanto custa para pedir um orçamento?" a="Nada. Descrever o serviço e comparar profissionais é gratuito. Você só paga o serviço que contratar." />
            <Faq q="Como sei que o profissional é confiável?" a="Todo profissional é verificado antes de atender, e você vê a avaliação real dele por tipo de serviço, além do número de trabalhos concluídos." />
            <Faq q="O aparelho já vem com instalação?" a="Sim. Na instalação de um ar novo, você compra o aparelho do nosso catálogo e a instalação entra junto, com preço claro antes de fechar." />
            <Faq q="Vocês atendem minha região?" a="No momento estamos em São Paulo. Digite seu CEP para ver os profissionais que atendem o seu endereço." />
          </div>
        </div>
      </section>

      {/* ---------------- PARA PROFISSIONAIS ---------------- */}
      <section id="profissionais" style={{ background: "var(--brand-ink)", color: "#eaf3f5" }}>
        <div className="container" style={{ padding: "72px 24px", display: "flex", flexWrap: "wrap", gap: 32, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ maxWidth: 520 }}>
            <p className="eyebrow" style={{ color: "#7fd0e0", marginBottom: 14 }}>Para profissionais</p>
            <h2 style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)", fontWeight: 800, lineHeight: 1.08, marginBottom: 14 }}>
              Você instala ou faz manutenção? Receba clientes da sua região.
            </h2>
            <p style={{ fontSize: "1.1rem", color: "#b8d3da", lineHeight: 1.55 }}>
              Monte seu perfil, mostre seu portfólio e apareça para quem está procurando agora.
              Entrar é gratuito enquanto estamos crescendo em São Paulo.
            </p>
          </div>
          <Link href="/signup" className="btn btn-onbrand btn-lg">Cadastrar como profissional <ArrowRight size={18} /></Link>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}

/* ---------------- subcomponentes ---------------- */
function SectionHead({ eyebrow, titulo, sub }: { eyebrow: string; titulo: string; sub?: string }) {
  return (
    <div style={{ maxWidth: 640 }}>
      <p className="eyebrow" style={{ marginBottom: 12 }}>{eyebrow}</p>
      <h2 style={{ fontSize: "clamp(1.7rem, 3.6vw, 2.3rem)", fontWeight: 800, lineHeight: 1.1 }}>{titulo}</h2>
      {sub && <p style={{ color: "var(--ink-soft)", fontSize: "1.08rem", marginTop: 12, lineHeight: 1.55 }}>{sub}</p>}
    </div>
  );
}
function Valor({ Icon, titulo, desc }: { Icon: (p: { size?: number }) => React.ReactElement; titulo: string; desc: string }) {
  return (
    <div>
      <span style={{ display: "grid", placeItems: "center", width: 46, height: 46, borderRadius: 12, background: "var(--cool)", color: "#fff", marginBottom: 16 }}>
        <Icon size={22} />
      </span>
      <h3 style={{ fontSize: "1.15rem", fontWeight: 700, marginBottom: 6 }}>{titulo}</h3>
      <p style={{ color: "var(--ink-soft)", fontSize: 15, lineHeight: 1.55 }}>{desc}</p>
    </div>
  );
}
function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details style={{ borderBottom: "1px solid var(--line)", padding: "6px 0" } as CSSProperties}>
      <summary style={{ cursor: "pointer", listStyle: "none", padding: "16px 0", fontSize: 16.5, fontWeight: 650, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
        {q}
        <span style={{ color: "var(--cool)", fontSize: 22, lineHeight: 1, fontWeight: 400 }} className="faq-mark">+</span>
      </summary>
      <p style={{ color: "var(--ink-soft)", fontSize: 15.5, lineHeight: 1.6, padding: "0 0 18px" }}>{a}</p>
    </details>
  );
}
