import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/icons";

const mono = "var(--font-geist-mono), ui-monospace, monospace";

/* Casca compartilhada por /termos e /privacidade.
   O aviso de rascunho é deliberadamente impossível de ignorar: publicar texto
   jurídico não revisado como se fosse definitivo é pior do que não ter página. */
export function LegalShell({ titulo, versao, children }: { titulo: string; versao: string; children: ReactNode }) {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px 96px" }}>
      <Link href="/" style={{ fontFamily: mono, fontSize: 14, fontWeight: 600, color: "var(--ink)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 8, background: "var(--cool)", color: "#fff" }}><Logo size={17} /></span>
        FrioHub
      </Link>

      <h1 style={{ fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.025em", margin: "28px 0 6px" }}>{titulo}</h1>
      <p style={{ fontFamily: mono, fontSize: 12.5, color: "var(--ink-faint)", margin: 0 }}>Versão {versao}</p>

      <div style={{ margin: "24px 0 32px", padding: "16px 18px", borderRadius: 12, background: "var(--warm-wash)", color: "var(--warm)", fontSize: 13.5, lineHeight: 1.6 }}>
        <strong style={{ color: "var(--ink)" }}>Rascunho — pendente de revisão jurídica.</strong>{" "}
        Este texto é um ponto de partida escrito para dar estrutura ao produto. Ele
        ainda <strong>não foi revisado por advogado</strong> e não deve ser tratado
        como documento legal definitivo. Substitua pelo texto oficial antes de operar
        comercialmente.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>{children}</div>

      <div style={{ marginTop: 40, paddingTop: 20, borderTop: "1px solid var(--line)", display: "flex", gap: 18, fontSize: 14 }}>
        <Link href="/termos" style={{ color: "var(--cool-deep)", fontWeight: 600 }}>Termos de Uso</Link>
        <Link href="/privacidade" style={{ color: "var(--cool-deep)", fontWeight: 600 }}>Política de Privacidade</Link>
      </div>
    </main>
  );
}

export function Secao({ t, children }: { t: string; children: ReactNode }) {
  return (
    <section>
      <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 8px" }}>{t}</h2>
      <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: 14.5, lineHeight: 1.7 }}>{children}</p>
    </section>
  );
}
