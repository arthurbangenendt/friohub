import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader, SiteFooter } from "@/components/site";
import { CIDADE, ESTADO } from "@/lib/regiao";
import { TAXA_COMISSAO } from "@/lib/pricing";
import { ArrowRight, Star, Shield, Bolt, Wrench, MapPin, Check } from "@/components/icons";
import type { CSSProperties } from "react";

const mono = "var(--font-geist-mono), ui-monospace, monospace";

export const metadata = {
  title: "Seja parceiro FrioHub — para técnicos e empresas de climatização",
  description: "Receba serviços de ar-condicionado na sua região, construa reputação por especialidade e seja encontrado por quem já quer contratar.",
};

const CAT_TITULO: Record<string, string> = {
  equipamento: "Equipamentos",
  servico: "Serviços",
  ambiente: "Ambientes",
  credencial: "Credenciais",
};

export default async function ParceirosPage() {
  const supabase = await createClient();

  // Catálogo real do banco — é o que o parceiro vai poder marcar no perfil.
  const { data: tags } = await supabase
    .from("skill_tags")
    .select("slug, label, categoria, ordem")
    .eq("ativo", true)
    .order("categoria")
    .order("ordem");

  const porCategoria = new Map<string, { slug: string; label: string }[]>();
  for (const t of tags ?? []) {
    const arr = porCategoria.get(t.categoria) ?? [];
    arr.push({ slug: t.slug, label: t.label });
    porCategoria.set(t.categoria, arr);
  }

  /* Números reais. Se ainda não há base, não inventamos — o bloco some.
     Conta todos os profissionais, não só os verificados: com o portão de
     verificação desligado no piloto, contar verificados mostraria zero mesmo
     havendo parceiros ativos. */
  const { count: numPros } = await supabase
    .from("professionals")
    .select("id", { count: "exact", head: true });
  const { count: numServicos } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .in("status", ["concluido", "avaliado"]);

  const temNumeros = (numPros ?? 0) > 0 || (numServicos ?? 0) > 0;
  const comissaoPct = Math.round(TAXA_COMISSAO * 100);

  const { data: { user } } = await supabase.auth.getUser();

  return (
    <>
      <SiteHeader logado={!!user} />
      <main>
      {/* ---------------- HERO ---------------- */}
      <section className="parc-hero">
        <div className="container">
          <span style={{ fontFamily: mono, fontSize: 11.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "#7fe0f2" }}>
            Para técnicos, autônomos e empresas
          </span>
          <h1 style={{ fontSize: "clamp(2.1rem, 5vw, 3.4rem)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.06, margin: "16px 0 18px", maxWidth: 720 }}>
            Seu próximo cliente já<br />sabe o que precisa.
          </h1>
          <p style={{ fontSize: "1.15rem", lineHeight: 1.6, color: "rgba(234,246,250,.78)", maxWidth: 560, margin: "0 0 32px" }}>
            Na FrioHub o cliente chega com ambiente medido, capacidade calculada e
            endereço confirmado. Você escolhe a região que atende e recebe só o
            serviço que faz sentido para você.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/signup?role=profissional" className="btn btn-onbrand btn-lg" style={{ gap: 8 }}>
              Quero ser parceiro <ArrowRight size={18} />
            </Link>
            <Link href="#como-funciona" className="btn btn-lg" style={{ background: "rgba(255,255,255,.1)", color: "#eaf6fa", border: "1px solid rgba(255,255,255,.2)" }}>
              Como funciona
            </Link>
          </div>

          <div style={{ display: "flex", gap: 26, marginTop: 34, flexWrap: "wrap" }}>
            <Selo icon={<Shield size={17} />} texto="Sem mensalidade para começar" />
            <Selo icon={<Bolt size={17} />} texto="Sem taxa para orçar" />
            <Selo icon={<MapPin size={17} />} texto={`${CIDADE} — ${ESTADO}`} />
          </div>
        </div>
      </section>

      {/* ---------------- NÚMEROS (só se existirem de verdade) ---------------- */}
      {temNumeros && (
        <section className="container" style={{ padding: "40px 24px 0" }}>
          <div className="parc-grid">
            {(numPros ?? 0) > 0 && <Numero valor={String(numPros)} label="Profissionais na plataforma" />}
            {(numServicos ?? 0) > 0 && <Numero valor={String(numServicos)} label="Serviços concluídos" />}
            <Numero valor={`${comissaoPct}%`} label="Comissão sobre o serviço" />
          </div>
        </section>
      )}

      {/* ---------------- BENEFÍCIOS ---------------- */}
      <section className="container" style={{ padding: "64px 24px" }}>
        <span className="eyebrow">Por que ser parceiro</span>
        <h2 style={h2}>O que muda no seu dia</h2>
        <div className="parc-grid" style={{ marginTop: 28 }}>
          <Beneficio Icon={Star} t="Reputação por especialidade"
            d="Sua nota é calculada separadamente para instalação, manutenção, limpeza, remanejamento e conserto. Quem é bom em um serviço não fica escondido atrás da média." />
          <Beneficio Icon={MapPin} t="Você define onde atende"
            d="Cadastre a região e receba apenas solicitações dentro dela. Nada de deslocamento que não compensa." />
          <Beneficio Icon={Wrench} t="Cliente que chega preparado"
            d="Área do ambiente, número de pessoas, insolação e capacidade recomendada já vêm preenchidos. Você orça sobre informação, não sobre suposição." />
          <Beneficio Icon={Bolt} t="Sem custo para participar"
            d={`Não há mensalidade para entrar. A comissão de ${comissaoPct}% incide sobre o serviço realizado — se não fechou, não paga.`} />
          <Beneficio Icon={Shield} t="Perfil verificado"
            d="Perfis conferidos pela equipe ganham o selo de verificado, que aparece para o cliente na hora de escolher." />
          <Beneficio Icon={Check} t="Portfólio que trabalha por você"
            d="Suba fotos dos seus serviços. É o que o cliente olha antes de escolher entre dois profissionais com a mesma nota." />
        </div>
      </section>

      {/* ---------------- COMO FUNCIONA ---------------- */}
      <section id="como-funciona" style={{ background: "var(--surface-2)", padding: "64px 0" }}>
        <div className="container">
          <span className="eyebrow">Como funciona</span>
          <h2 style={h2}>Do cadastro ao primeiro serviço</h2>
          <div className="parc-grid" style={{ marginTop: 28 }}>
            <Passo n="01" t="Crie sua conta" d="Nome, contato e CPF ou CNPJ. Leva um minuto." />
            <Passo n="02" t="Monte seu perfil técnico" d="Marque suas especialidades, os equipamentos que domina, os ambientes que atende e sua região." />
            <Passo n="03" t="Apareça nas buscas" d="Assim que o perfil técnico estiver completo, você já aparece para os clientes cuja necessidade bate com as suas especialidades." />
            <Passo n="04" t="Receba e execute" d="O cliente escolhe você, vocês combinam pelo painel e o serviço acontece." />
          </div>
        </div>
      </section>

      {/* ---------------- O QUE VOCÊ PODE CADASTRAR (catálogo real) ---------------- */}
      <section className="container" style={{ padding: "64px 24px" }}>
        <span className="eyebrow">Seu perfil técnico</span>
        <h2 style={h2}>Detalhe exatamente o que você faz</h2>
        <p style={{ color: "var(--ink-soft)", maxWidth: 620, marginTop: 10, lineHeight: 1.65 }}>
          Ar-condicionado não é um serviço só. Quem instala VRF em corporativo não faz
          o mesmo trabalho de quem higieniza split residencial — e o cliente precisa
          enxergar essa diferença. Estas são as opções que você marca no seu perfil:
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 28 }}>
          {["servico", "equipamento", "ambiente", "credencial"].map((cat) => {
            const itens = porCategoria.get(cat) ?? [];
            if (itens.length === 0) return null;
            return (
              <div key={cat}>
                <h3 style={{ fontSize: 13, fontFamily: mono, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-faint)", margin: "0 0 10px" }}>
                  {CAT_TITULO[cat] ?? cat}
                </h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {itens.map((i) => (
                    <span key={i.slug} style={tag}>{i.label}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-faint)", marginTop: 18 }}>
          Credenciais são autodeclaradas no cadastro e conferidas na verificação do perfil.
        </p>
      </section>

      {/* ---------------- FAQ ---------------- */}
      <section className="container" style={{ padding: "64px 24px" }}>
        <span className="eyebrow">Dúvidas</span>
        <h2 style={h2}>Perguntas frequentes</h2>
        <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 2 }}>
          <Faq q="Preciso ter CNPJ?" a="Não. Autônomos podem se cadastrar com CPF. Empresas usam CNPJ e podem informar a razão social." />
          <Faq q="Tem mensalidade?" a={`Não há mensalidade para participar. A plataforma retém ${comissaoPct}% sobre o serviço realizado — orçar não custa nada.`} />
          <Faq q="Quando eu começo a aparecer para os clientes?" a="Assim que você completar o perfil técnico com pelo menos uma especialidade e sua região. A partir daí você entra nas buscas dos clientes cuja necessidade bate com o que você faz." />
          <Faq q="Posso escolher onde atendo?" a={`Sim. Você cadastra a região de atendimento e só recebe solicitações dela. No momento a operação está concentrada em ${CIDADE} — ${ESTADO}.`} />
          <Faq q="Como recebo pelo serviço?" a="O painel do parceiro mostra o valor líquido de cada serviço, já descontada a comissão. O fluxo de repasse é informado no painel." />
        </div>
      </section>

      {/* ---------------- CTA FINAL ---------------- */}
      <section className="container" style={{ padding: "0 24px 88px" }}>
        <div style={{ padding: "44px 40px", borderRadius: 20, background: "var(--cool)", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 6px" }}>Pronto para começar?</h2>
            <p style={{ margin: 0, opacity: 0.9, fontSize: 15 }}>Criar a conta leva um minuto. O perfil técnico você monta depois, com calma.</p>
          </div>
          <Link href="/signup?role=profissional" className="btn btn-onbrand btn-lg" style={{ gap: 8, flexShrink: 0 }}>
            Criar conta de parceiro <ArrowRight size={18} />
          </Link>
        </div>
      </section>
      </main>
      <SiteFooter />
    </>
  );
}

/* ---------- subcomponentes ---------- */
function Selo({ icon, texto }: { icon: React.ReactNode; texto: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8, color: "rgba(234,246,250,.8)", fontSize: 14 }}>
      <span style={{ color: "#7fe0f2", display: "flex" }}>{icon}</span> {texto}
    </span>
  );
}

function Numero({ valor, label }: { valor: string; label: string }) {
  return (
    <div className="card" style={{ padding: "22px 24px" }}>
      <div className="parc-num">{valor}</div>
      <div style={{ fontSize: 13.5, color: "var(--ink-faint)", marginTop: 4 }}>{label}</div>
    </div>
  );
}

function Beneficio({ Icon, t, d }: { Icon: (p: { size?: number }) => React.ReactElement; t: string; d: string }) {
  return (
    <div className="card" style={{ padding: 24 }}>
      <span style={{ display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: 11, background: "var(--cool-wash)", color: "var(--cool-deep)" }}>
        <Icon size={20} />
      </span>
      <h3 style={{ fontSize: "1.02rem", fontWeight: 700, margin: "14px 0 6px" }}>{t}</h3>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: "var(--ink-soft)" }}>{d}</p>
    </div>
  );
}

function Passo({ n, t, d }: { n: string; t: string; d: string }) {
  return (
    <div>
      <div style={{ fontFamily: mono, fontSize: 12.5, color: "var(--cool)", letterSpacing: "0.1em" }}>{n}</div>
      <h3 style={{ fontSize: "1.02rem", fontWeight: 700, margin: "8px 0 6px" }}>{t}</h3>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: "var(--ink-soft)" }}>{d}</p>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details style={{ borderBottom: "1px solid var(--line)", padding: "16px 0" }}>
      <summary style={{ cursor: "pointer", fontWeight: 650, fontSize: 15.5, display: "flex", justifyContent: "space-between", gap: 16, listStyle: "none" }}>
        {q} <span className="faq-mark" style={{ color: "var(--ink-faint)", fontWeight: 400 }}>+</span>
      </summary>
      <p style={{ margin: "10px 0 0", color: "var(--ink-soft)", fontSize: 14.5, lineHeight: 1.7 }}>{a}</p>
    </details>
  );
}

const h2: CSSProperties = { fontSize: "clamp(1.5rem, 3vw, 2.05rem)", fontWeight: 800, letterSpacing: "-0.025em", margin: "10px 0 0" };
const tag: CSSProperties = {
  fontSize: 13.5, padding: "7px 13px", borderRadius: 100,
  border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink-soft)",
};
