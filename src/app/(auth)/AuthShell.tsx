import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Logo } from "@/components/icons";

const mono = "var(--font-geist-mono), ui-monospace, monospace";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  error,
  aviso,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
  error?: string;
  aviso?: string;
}) {
  return (
    <main style={wrap}>
      <div style={card}>
        <Link href="/" style={brand}>
          <span style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 8, background: "var(--cool)", color: "#fff" }}><Logo size={17} /></span>
          FrioHub
        </Link>
        <h1 style={h1}>{title}</h1>
        <p style={sub}>{subtitle}</p>

        {error ? <div style={alert("erro")}>{error}</div> : null}
        {aviso ? <div style={alert("aviso")}>{aviso}</div> : null}

        {children}

        <div style={foot}>{footer}</div>
      </div>
    </main>
  );
}

const wrap: CSSProperties = {
  minHeight: "100dvh",
  display: "grid",
  placeItems: "center",
  padding: 24,
};
const card: CSSProperties = {
  width: "100%",
  maxWidth: 400,
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 18,
  padding: "34px 32px 28px",
  boxShadow: "0 8px 30px rgba(14,27,38,.08)",
};
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

function alert(kind: "erro" | "aviso"): CSSProperties {
  const erro = kind === "erro";
  return {
    fontSize: 13.5,
    padding: "10px 14px",
    borderRadius: 10,
    marginBottom: 18,
    background: erro ? "#fdeceb" : "var(--warm-wash)",
    color: erro ? "#b3261e" : "var(--warm)",
    border: `1px solid ${erro ? "#f5c6c2" : "transparent"}`,
  };
}
