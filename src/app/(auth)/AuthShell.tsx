import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Logo, Wrench, Star, Bolt, ArrowRight, Shield, Chat } from "@/components/icons";

const mono = "var(--font-geist-mono), ui-monospace, monospace";

type AsideRole = "cliente" | "profissional";

type Beneficio = { Icon: (p: { size?: number }) => ReactNode; t: string; d: string };

const ASIDE_CONTEUDO: Record<AsideRole, {
  eyebrow: string;
  titulo: ReactNode;
  sub: string;
  beneficios: Beneficio[];
  ctaHref: string;
  ctaLabel: string;
}> = {
  profissional: {
    eyebrow: "Para técnicos e empresas",
    titulo: <>Seja parceiro<br />FrioHub</>,
    sub: "Receba serviços de climatização na sua região, construa sua reputação e seja encontrado por quem já está pronto para contratar.",
    beneficios: [
      { Icon: Wrench, t: "Serviços na sua região", d: "Você escolhe os bairros que atende e recebe só o que faz sentido." },
      { Icon: Star, t: "Reputação por especialidade", d: "Sua nota é separada por serviço — quem é bom em instalação aparece em instalação." },
      { Icon: Bolt, t: "Sem taxa para orçar", d: "A comissão só existe quando o serviço acontece." },
    ],
    ctaHref: "/parceiros",
    ctaLabel: "Quero ser parceiro",
  },
  cliente: {
    eyebrow: "Para quem contrata",
    titulo: <>Contrate com<br />segurança</>,
    sub: "Peça orçamento com o ambiente já calculado, acompanhe tudo pelo chat e só libere o pagamento quando o serviço estiver confirmado.",
    beneficios: [
      { Icon: Shield, t: "Pagamento protegido", d: "O valor fica retido até você confirmar que o serviço foi feito — só então o profissional recebe." },
      { Icon: Star, t: "Profissionais avaliados", d: "Nota separada por especialidade: quem instala bem não se esconde atrás da média de quem só limpa." },
      { Icon: Chat, t: "Chat direto, sem intermediário escondido", d: "Converse pelo painel e leve pro WhatsApp quando quiser — sem taxa por isso." },
    ],
    ctaHref: "/clientes",
    ctaLabel: "Saiba mais",
  },
};

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  error,
  aviso,
  aba,
  proximo,
  asideRole,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
  error?: string;
  aviso?: string;
  /** Qual aba fica ativa. `null` esconde as abas (fluxos fora do par entrar/criar). */
  aba?: "login" | "signup" | null;
  /** Destino a preservar ao alternar entre Entrar e Criar conta. Sem isso, quem
   *  chega de `/solicitar` e percebe que ainda não tem conta perde o contexto
   *  justamente no clique da aba. */
  proximo?: string;
  /** Qual conteúdo o painel lateral mostra. `/login` não passa essa prop (sem
   *  seletor de papel), então cai no default e mantém sempre "Seja parceiro". */
  asideRole?: AsideRole;
}) {
  const q = proximo && proximo !== "/painel" ? `?next=${encodeURIComponent(proximo)}` : "";
  const conteudo = ASIDE_CONTEUDO[asideRole ?? "profissional"];
  return (
    <main className="auth-split">
      {/* ---- coluna do formulário ---- */}
      <section className="auth-main">
        <div className="auth-card">
          <Link href="/" style={brand}>
            <span style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 8, background: "var(--cool)", color: "#fff" }}><Logo size={17} /></span>
            FrioHub
          </Link>

          {aba !== null && (
            <div className="auth-tabs">
              <Link href={`/login${q}`} className="auth-tab" data-on={String(aba === "login")}>Entrar</Link>
              <Link href={`/signup${q}`} className="auth-tab" data-on={String(aba === "signup")}>Criar conta</Link>
            </div>
          )}

          <h1 style={h1}>{title}</h1>
          <p style={sub}>{subtitle}</p>

          {error ? <div style={alerta("erro")}>{error}</div> : null}
          {aviso ? <div style={alerta("aviso")}>{aviso}</div> : null}

          {children}

          {footer ? <div style={foot}>{footer}</div> : null}
        </div>
      </section>

      {/* ---- coluna "seja parceiro" / "seja cliente" ---- */}
      <aside className="auth-aside">
        <div>
          <span style={{ fontFamily: mono, fontSize: 11.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "#7fe0f2" }}>
            {conteudo.eyebrow}
          </span>
          <h2 className="auth-aside-title" style={{ marginTop: 12 }}>
            {conteudo.titulo}
          </h2>
          <p className="auth-aside-sub" style={{ marginTop: 14 }}>
            {conteudo.sub}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {conteudo.beneficios.map((b) => (
            <div key={b.t} className="auth-benefit">
              <span className="auth-benefit-ic"><b.Icon size={17} /></span>
              <div>
                <div className="auth-benefit-t">{b.t}</div>
                <div className="auth-benefit-d">{b.d}</div>
              </div>
            </div>
          ))}
        </div>

        <Link href={conteudo.ctaHref} className="btn btn-onbrand" style={{ alignSelf: "flex-start", gap: 8 }}>
          {conteudo.ctaLabel} <ArrowRight size={17} />
        </Link>
      </aside>
    </main>
  );
}

const brand: CSSProperties = {
  fontFamily: mono,
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: "0.02em",
  color: "var(--ink)",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 24,
};
const h1: CSSProperties = {
  fontSize: "1.55rem",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  margin: "0 0 6px",
};
const sub: CSSProperties = { color: "var(--ink-faint)", fontSize: 14, margin: "0 0 22px" };
const foot: CSSProperties = {
  marginTop: 22,
  paddingTop: 18,
  borderTop: "1px solid var(--line)",
  fontSize: 14,
  color: "var(--ink-soft)",
  textAlign: "center",
};

function alerta(kind: "erro" | "aviso"): CSSProperties {
  const erro = kind === "erro";
  return {
    fontSize: 13.5,
    padding: "10px 14px",
    borderRadius: 10,
    marginBottom: 18,
    background: erro ? "var(--danger-wash)" : "var(--warm-wash)",
    color: erro ? "var(--danger)" : "var(--warm)",
    border: `1px solid ${erro ? "#f5c6c2" : "transparent"}`,
  };
}
