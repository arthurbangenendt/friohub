"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { REGIAO_LABEL } from "@/lib/regiao";
import { Logo } from "./icons";

/** Quando `overHero`, o header flutua transparente sobre a seção inicial e só
 * ganha fundo sólido depois que a página rola — usado na home, onde o hero
 * ocupa a tela inteira e não pode ter uma barra branca cortando o topo. */
/* Uma lista só, consumida pela barra no desktop e pelo painel no celular —
   assim não existe a chance de as duas navegações divergirem. */
const LINKS = [
  { href: "/#como-funciona", label: "Como funciona" },
  { href: "/#servicos", label: "Serviços" },
  /* Vem antes das landings de parceiro: é a página que interessa a quem está
     procurando alguém, que é a maior parte de quem chega no site. */
  { href: "/profissionais", label: "Profissionais" },
  // Aponta para a landing de parceiros, não mais para uma âncora da home.
  { href: "/parceiros", label: "Para profissionais" },
  /* Planos fica colado em "Para profissionais": quem clica ali é quem cogita
     ser parceiro, e preço é a próxima pergunta dele. */
  { href: "/planos", label: "Planos" },
  { href: "/distribuidoras", label: "Para distribuidoras" },
];

export function SiteHeader({ overHero = false, logado = false }: { overHero?: boolean; logado?: boolean }) {
  const [solid, setSolid] = useState(!overHero);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!overHero) return;
    const onScroll = () => setSolid(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [overHero]);

  /* Esc fecha o menu. Sem isso, quem navega por teclado abre o painel e fica
     preso tendo que tabular por ele inteiro para sair. */
  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aberto]);

  // Painel aberto sobre o hero transparente ficaria ilegível.
  const solidLook = !overHero || solid || aberto;

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
      {/* `relative` ancora o painel do menu mobile, que é posicionado a partir
          da base desta barra. */}
      <div className="container" style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", height: 66 }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 700, fontSize: 18, letterSpacing: "-0.02em", color: solidLook ? "var(--ink)" : "#fff" }}>
          <span style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 9, background: solidLook ? "var(--cool)" : "rgba(255,255,255,.16)", color: "#fff", backdropFilter: solidLook ? undefined : "blur(6px)" }}>
            <Logo size={19} />
          </span>
          FrioHub
        </Link>

        <nav style={{ display: "flex", alignItems: "center", gap: 30 }} className="site-nav-links">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} style={{ ...navLink, color: solidLook ? "var(--ink-soft)" : "rgba(255,255,255,.82)" }}>
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Oferecer "Entrar" a quem já entrou é ruído. Logado vê o caminho de volta. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {logado ? (
            <Link href="/painel" className="btn btn-primary" style={{ height: 40, padding: "0 16px", fontSize: 14 }}>Ir para o painel</Link>
          ) : (
            <>
              <Link href="/login" style={{ ...navLink, fontWeight: 600, color: solidLook ? "var(--ink-soft)" : "rgba(255,255,255,.9)" }}>Entrar</Link>
              <Link href="/signup" className="btn btn-primary site-cta-desktop" style={{ height: 40, padding: "0 16px", fontSize: 14 }}>Criar conta</Link>
            </>
          )}
          <button
            type="button"
            className="site-nav-toggle"
            data-sobre-hero={String(!solidLook)}
            aria-expanded={aberto}
            aria-controls="menu-site"
            aria-label={aberto ? "Fechar menu" : "Abrir menu"}
            onClick={() => setAberto((a) => !a)}
          >
            <Sanduiche aberto={aberto} />
          </button>
        </div>

        {aberto && (
          <nav id="menu-site" className="site-nav-painel">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setAberto(false)}>{l.label}</Link>
            ))}
            {!logado && (
              <Link href="/signup" className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setAberto(false)}>
                Criar conta
              </Link>
            )}
          </nav>
        )}
      </div>
    </header>
  );
}

/* Duas barras que viram X. `aria-hidden` porque o rótulo já está no botão —
   sem isso o leitor de tela anuncia o ícone além do nome da ação. */
function Sanduiche({ aberto }: { aberto: boolean }) {
  const barra: React.CSSProperties = {
    display: "block", width: 18, height: 2, borderRadius: 2,
    background: "currentColor", transition: "transform .18s ease, opacity .18s ease",
  };
  return (
    <span aria-hidden style={{ display: "grid", gap: 4 }}>
      <span style={{ ...barra, transform: aberto ? "translateY(3px) rotate(45deg)" : undefined }} />
      <span style={{ ...barra, transform: aberto ? "translateY(-3px) rotate(-45deg)" : undefined }} />
    </span>
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
            Instalação, manutenção, limpeza, remanejamento e conserto de ar-condicionado, com
            profissionais avaliados da sua região.
          </p>
        </div>
        {/* Itens do rodapé são links de verdade: antes eram <li> de texto puro que
            pareciam navegação e não levavam a lugar nenhum. */}
        <div style={{ display: "flex", gap: 56, flexWrap: "wrap" }}>
          <FooterCol
            titulo="Serviços"
            itens={[
              { label: "Instalação", href: "/#servicos" },
              { label: "Manutenção", href: "/#servicos" },
              { label: "Limpeza", href: "/#servicos" },
              { label: "Remanejamento", href: "/#servicos" },
              { label: "Conserto", href: "/#servicos" },
            ]}
          />
          <FooterCol
            titulo="FrioHub"
            itens={[
              { label: "Como funciona", href: "/#como-funciona" },
              { label: "Ver profissionais", href: "/profissionais" },
              { label: "Para profissionais", href: "/parceiros" },
              { label: "Para distribuidoras", href: "/distribuidoras" },
              { label: "Entrar", href: "/login" },
              { label: "Criar conta", href: "/signup" },
            ]}
          />
          <FooterCol
            titulo="Legal"
            itens={[
              { label: "Termos de uso", href: "/termos" },
              { label: "Privacidade", href: "/privacidade" },
            ]}
          />
        </div>
      </div>
      <div className="container" style={{ padding: "18px 24px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--ink-faint)" }}>© {new Date().getFullYear()} FrioHub. Atendendo {REGIAO_LABEL}.</span>
        <span style={{ fontSize: 13, color: "var(--ink-faint)" }}>Feito para quem cuida do conforto.</span>
      </div>
    </footer>
  );
}

function FooterCol({ titulo, itens }: { titulo: string; itens: { label: string; href: string }[] }) {
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 650, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)", marginBottom: 14 }}>{titulo}</div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {itens.map((i) => (
          <li key={`${titulo}-${i.label}`}>
            <Link href={i.href} style={{ fontSize: 14, color: "var(--ink-soft)" }}>{i.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const navLink: React.CSSProperties = { fontSize: 14.5, color: "var(--ink-soft)" };
