import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader, SiteFooter } from "@/components/site";
import { CIDADE, ESTADO } from "@/lib/regiao";
import { NeonMesh } from "@/components/ui/neon-mesh";
import { ArrowRight, Shield, MapPin, Star, Chat, Check, Bolt } from "@/components/icons";
import type { CSSProperties } from "react";

const mono = "var(--font-geist-mono), ui-monospace, monospace";

export const metadata = {
  title: "Seja cliente FrioHub — contrate ar-condicionado com segurança",
  description: "Peça orçamento com o ambiente já calculado, escolha entre profissionais avaliados por especialidade e só libere o pagamento quando o serviço estiver confirmado.",
};

export default async function ClientesPage() {
  const supabase = await createClient();

  const { count: numPros } = await supabase
    .from("professionals")
    .select("id", { count: "exact", head: true });
  const { count: numServicos } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .in("status", ["concluido", "avaliado"]);

  const temNumeros = (numPros ?? 0) > 0 || (numServicos ?? 0) > 0;

  const { data: { user } } = await supabase.auth.getUser();

  return (
    <>
      <SiteHeader logado={!!user} />
      <main>
      {/* ---------------- HERO ---------------- */}
      <NeonMesh
        subtitle="Para quem contrata"
        title="Contrate ar-condicionado com o pagamento protegido até o serviço acontecer."
        description="Peça orçamento com o ambiente já calculado, escolha entre profissionais avaliados por especialidade e só libere o pagamento quando o serviço estiver confirmado."
      >
        <Link href="/signup" className="btn btn-onbrand btn-lg" style={{ gap: 8 }}>
          Criar conta grátis <ArrowRight size={18} />
        </Link>
        <Link href="#como-funciona" className="btn btn-lg" style={{ background: "rgba(255,255,255,.1)", color: "#eaf6fa", border: "1px solid rgba(255,255,255,.2)" }}>
          Como funciona
        </Link>
      </NeonMesh>

      <section className="container" style={{ padding: "28px 24px 0" }}>
        <div style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
          <Selo icon={<Shield size={17} />} texto="Sem custo para contratar" />
          <Selo icon={<Bolt size={17} />} texto="Pagamento retido até você confirmar" />
          <Selo icon={<MapPin size={17} />} texto={`${CIDADE} — ${ESTADO}`} />
        </div>
      </section>

      {/* ---------------- NÚMEROS (só se existirem de verdade) ---------------- */}
      {temNumeros && (
        <section className="container" style={{ padding: "40px 24px 0" }}>
          <div className="parc-grid">
            {(numPros ?? 0) > 0 && <Numero valor={String(numPros)} label="Profissionais avaliados disponíveis" />}
            {(numServicos ?? 0) > 0 && <Numero valor={String(numServicos)} label="Serviços concluídos" />}
          </div>
        </section>
      )}

      {/* ---------------- BENEFÍCIOS ---------------- */}
      <section className="container" style={{ padding: "64px 24px" }}>
        <span className="eyebrow">Por que contratar pela FrioHub</span>
        <h2 style={h2}>O que muda para você</h2>
        <div className="parc-grid" style={{ marginTop: 28 }}>
          <Beneficio Icon={Shield} t="Pagamento protegido"
            d="O valor fica retido pela plataforma até você confirmar que o serviço foi concluído. Só então o profissional recebe." />
          <Beneficio Icon={MapPin} t="Orçamento calculado, não chutado"
            d="Informe o ambiente e a plataforma já calcula a capacidade recomendada — o profissional orça sobre dado, não sobre suposição." />
          <Beneficio Icon={Star} t="Profissionais avaliados por especialidade"
            d="A nota de quem instala é separada da nota de quem limpa. Você vê exatamente quem é bom no serviço que você precisa." />
          <Beneficio Icon={Chat} t="Chat direto, sem custo escondido"
            d="Combine detalhes pelo painel e leve pro WhatsApp quando quiser — o app é gratuito para quem contrata." />
          <Beneficio Icon={Check} t="Sem mensalidade, sem taxa de contato"
            d="Quem paga comissão é o profissional, quando o serviço acontece. Pedir orçamento nunca custa nada." />
          <Beneficio Icon={Bolt} t="Do orçamento ao serviço, rápido"
            d="Escolha entre os profissionais disponíveis na sua região e combine a execução direto pelo painel." />
        </div>
      </section>

      {/* ---------------- COMO FUNCIONA ---------------- */}
      <section id="como-funciona" style={{ background: "var(--surface-2)", padding: "64px 0" }}>
        <div className="container">
          <span className="eyebrow">Como funciona</span>
          <h2 style={h2}>Do pedido ao serviço concluído</h2>
          <div className="parc-grid" style={{ marginTop: 28 }}>
            <Passo n="01" t="Diga o que precisa" d="Ambiente, tipo de serviço e endereço. Leva menos de um minuto." />
            <Passo n="02" t="Compare profissionais avaliados" d="Veja nota por especialidade, região atendida e valor antes de escolher." />
            <Passo n="03" t="Combine pelo chat" d="Tire dúvidas, negocie detalhes e marque a visita direto pelo painel." />
            <Passo n="04" t="Pague com segurança" d="O valor fica retido até você confirmar que o serviço foi concluído como combinado." />
          </div>
        </div>
      </section>

      {/* ---------------- FAQ ---------------- */}
      <section className="container" style={{ padding: "64px 24px" }}>
        <span className="eyebrow">Dúvidas</span>
        <h2 style={h2}>Perguntas frequentes</h2>
        <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 2 }}>
          <Faq q="Preciso pagar para usar a plataforma?" a="Não. Pedir orçamento e usar o chat com o profissional é gratuito para quem contrata — quem paga comissão é o profissional, e só quando o serviço acontece." />
          <Faq q="Como funciona a proteção do pagamento?" a="O valor combinado fica retido pela plataforma. O repasse ao profissional só acontece depois que você confirma que o serviço foi concluído." />
          <Faq q="E se o serviço não sair como combinado?" a="Nossos Termos de Uso preveem suporte da equipe em caso de disputa sobre um serviço — fale com a gente pelo painel se algo não sair como esperado." />
          <Faq q="Os profissionais são verificados?" a="Perfis conferidos pela equipe ganham o selo de verificado, visível para você na hora de escolher." />
          <Faq q="Dá para falar pelo WhatsApp?" a="Sim. Você começa a conversa pelo chat interno e pode levar para o WhatsApp quando quiser." />
        </div>
      </section>

      {/* ---------------- CTA FINAL ---------------- */}
      <section className="container" style={{ padding: "0 24px 88px" }}>
        <div style={{ padding: "44px 40px", borderRadius: 20, background: "var(--cool)", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 6px" }}>Pronto para contratar?</h2>
            <p style={{ margin: 0, opacity: 0.9, fontSize: 15 }}>Criar a conta leva um minuto. Você só paga quando o serviço acontecer.</p>
          </div>
          <Link href="/signup" className="btn btn-onbrand btn-lg" style={{ gap: 8, flexShrink: 0 }}>
            Criar conta grátis <ArrowRight size={18} />
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
    <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink-soft)", fontSize: 14 }}>
      <span style={{ color: "var(--cool)", display: "flex" }}>{icon}</span> {texto}
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
