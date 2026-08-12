"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "./icons";

/** Quando `overHero`, o header flutua transparente sobre a seção inicial e só
 * ganha fundo sólido depois que a página rola — usado na home, onde o hero
 * ocupa a tela inteira e não pode ter uma barra branca cortando o topo. */
export function SiteHeader({ overHero = false }: { overHero?: boolean }) {
  const [solid, setSolid] = useState(!overHero);

  useEffect(() => {
    if (!overHero) return;
    const onScroll = () => setSolid(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [overHero]);

  const solidLook = !overHero || solid;

  return (
    <header
      style={{
        position: overHero ? "fixed" : "sticky",
        top: 0, left: 0, right: 0, zIndex: 50,
        background: solidLook ? "color-mix(in srgb, var(--bg) 88%, transparent)" : "transparent",
        backdropFilter: solidLook ? "saturate(140%) blur(10px)" : "none",
        borderBottom: solidLook ? "1px solid var(--line)" : "1px solid transparent",
        transition: "background .25s ease, border-color .25s ease",
      }}
    >
      <div className="container" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 66 }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 700, fontSize: 18, letterSpacing: "-0.02em", color: solidLook ? "var(--ink)" : "#fff" }}>
          <span style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 9, background: solidLook ? "var(--cool)" : "rgba(255,255,255,.16)", color: "#fff", backdropFilter: solidLook ? undefined : "blur(6px)" }}>
            <Logo size={19} />
          </span>
          FrioHub
        </Link>

        <nav style={{ display: "flex", alignItems: "center", gap: 30 }} className="site-nav-links">
          <a href="/#como-funciona" style={{ ...navLink, color: solidLook ? "var(--ink-soft)" : "rgba(255,255,255,.82)" }}>Como funciona</a>
          <a href="/#servicos" style={{ ...navLink, color: solidLook ? "var(--ink-soft)" : "rgba(255,255,255,.82)" }}>Serviços</a>
          <a href="/#profissionais" style={{ ...navLink, color: solidLook ? "var(--ink-soft)" : "rgba(255,255,255,.82)" }}>Para profissionais</a>
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/login" style={{ ...navLink, fontWeight: 600, color: solidLook ? "var(--ink-soft)" : "rgba(255,255,255,.9)" }}>Entrar</Link>
          <Link href="/signup" className="btn btn-primary" style={{ height: 40, padding: "0 16px", fontSize: 14 }}>Criar conta</Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer style={{ borderTop: "1px solid var(--line)", background: "var(--bg-subtle)", marginTop: 0 }}>
      <div className="container" style={{ padding: "48px 24px", display: "flex", flexWrap: "wrap", gap: 32, justifyContent: "space-between" }}>
        <div style={{ maxWidth: 300 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 700, fontSize: 17 }}>
            <span style={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 8, background: "var(--cool)", color: "#fff" }}>
              <Logo size={18} />
            </span>
            FrioHub
          </div>
          <p style={{ color: "var(--ink-faint)", fontSize: 14, marginTop: 12 }}>
            Ar-condicionado instalado e cuidado por profissionais avaliados da sua região.
          </p>
        </div>
        <div style={{ display: "flex", gap: 56, flexWrap: "wrap" }}>
          <FooterCol titulo="Serviços" itens={["Instalação", "Manutenção", "Limpeza", "Remanejamento", "Conserto"]} />
          <FooterCol titulo="FrioHub" itens={["Como funciona", "Para profissionais", "Entrar", "Criar conta"]} />
        </div>
      </div>
      <div className="container" style={{ padding: "18px 24px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--ink-faint)" }}>© {new Date().getFullYear()} FrioHub. Atendendo Fortaleza — CE.</span>
        <span style={{ fontSize: 13, color: "var(--ink-faint)" }}>Feito para quem cuida do conforto.</span>
      </div>
    </footer>
  );
}

function FooterCol({ titulo, itens }: { titulo: string; itens: string[] }) {
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 650, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)", marginBottom: 14 }}>{titulo}</div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {itens.map((i) => <li key={i} style={{ fontSize: 14, color: "var(--ink-soft)" }}>{i}</li>)}
      </ul>
    </div>
  );
}

const navLink: React.CSSProperties = { fontSize: 14.5, color: "var(--ink-soft)" };
