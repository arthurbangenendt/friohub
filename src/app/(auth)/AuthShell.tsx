import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Logo, Wrench, Star, Bolt, ArrowRight } from "@/components/icons";

const mono = "var(--font-geist-mono), ui-monospace, monospace";

const BENEFICIOS = [
  { Icon: Wrench, t: "Serviços na sua região", d: "Você escolhe os bairros que atende e recebe só o que faz sentido." },
  { Icon: Star, t: "Reputação por especialidade", d: "Sua nota é separada por serviço — quem é bom em instalação aparece em instalação." },
  { Icon: Bolt, t: "Sem taxa para orçar", d: "A comissão só existe quando o serviço acontece." },
];

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  error,
  aviso,
  aba,
  proximo,
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
}) {
  const q = proximo && proximo !== "/painel" ? `?next=${encodeURIComponent(proximo)}` : "";
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

      {/* ---- coluna "seja parceiro" ---- */}
      <aside className="auth-aside">
        <div>
          <span style={{ fontFamily: mono, fontSize: 11.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "#7fe0f2" }}>
            Para técnicos e empresas
          </span>
          <h2 className="auth-aside-title" style={{ marginTop: 12 }}>
            Seja parceiro<br />FrioHub
          </h2>
          <p className="auth-aside-sub" style={{ marginTop: 14 }}>
            Receba serviços de climatização na sua região, construa sua reputação e
            seja encontrado por quem já está pronto para contratar.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {BENEFICIOS.map((b) => (
            <div key={b.t} className="auth-benefit">
              <span className="auth-benefit-ic"><b.Icon size={17} /></span>
              <div>
                <div className="auth-benefit-t">{b.t}</div>
                <div className="auth-benefit-d">{b.d}</div>
              </div>
            </div>
          ))}
        </div>

        <Link href="/parceiros" className="btn btn-onbrand" style={{ alignSelf: "flex-start", gap: 8 }}>
          Quero ser parceiro <ArrowRight size={17} />
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
