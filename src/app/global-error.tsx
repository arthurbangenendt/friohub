"use client";

import { useEffect } from "react";

/* Rede de segurança para erro que escapa do próprio `layout.tsx` raiz — algo
 * fora de qualquer segmento de rota, então `error.tsx` (que só cobre os
 * filhos do layout) não alcança. Hoje o único candidato real é o widget do
 * Chatwoot (`ChatwootWidget`, renderizado direto no `<body>` do layout):
 * quando o `sdk.js` de terceiro falha depois de carregado (ex.: 429 do
 * Cloudflare na frente do Chatwoot self-hosted), o erro sobe sem passar por
 * nenhum error boundary de segmento e, sem este arquivo, o Next mostra a tela
 * genérica em inglês "This page couldn't load" — foi isso que aconteceu em
 * 02/09/2026 e derrubou a navegação inteira, em toda página, para todo login.
 *
 * `global-error.tsx` substitui o documento inteiro quando ativa (por isso
 * define <html>/<body> próprios) — não pode depender de nada que possa falhar
 * junto, então os estilos são inline e a fonte é a do sistema, sem
 * `next/font` nem `globals.css`. */
export default function ErroGlobalRaiz({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] erro na raiz", error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
        <style dangerouslySetInnerHTML={{ __html: `
          :root { --surface: #fff; --ink: #0c1e2a; --ink-soft: #51636c; --line: #e2eaee; --cool: #0d6e8f; --cool-deep: #0a5670; }
          @media (prefers-color-scheme: dark) {
            :root { --surface: #0f2531; --ink: #e7eff2; --ink-soft: #a2b3bb; --line: #1e3742; --cool: #2ca6c4; --cool-deep: #57c3da; }
          }
          body { background: var(--surface); color: var(--ink); }
        ` }} />
        <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "60px 24px" }}>
          <div style={{ maxWidth: 480, textAlign: "center" }}>
            <h1 style={{ fontSize: "1.6rem", fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }}>
              Algo deu errado por aqui
            </h1>
            <p style={{ color: "var(--ink-soft)", marginTop: 12, lineHeight: 1.6 }}>
              A falha foi registrada e nada do que você preencheu foi perdido. Tente de novo — se
              persistir, volte para o início.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 24, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                onClick={reset}
                style={{ height: 42, padding: "0 20px", borderRadius: 10, border: "none", background: "var(--cool)", color: "#fff", fontWeight: 600, fontSize: 14, cursor: "pointer" }}
              >
                Tentar de novo
              </button>
              {/* <a> nativo de propósito, não <Link>: este componente vive fora da
                  árvore do App Router (substitui o <html> inteiro), então o
                  roteador client-side pode não estar num estado confiável aqui —
                  uma navegação de página cheia é o caminho seguro. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                style={{ height: 42, display: "inline-flex", alignItems: "center", padding: "0 20px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", fontWeight: 600, fontSize: 14, textDecoration: "none" }}
              >
                Ir para o início
              </a>
            </div>
            {error.digest && (
              <p style={{ marginTop: 22, fontSize: 12.5, color: "var(--ink-soft)" }}>
                Código para o suporte: <strong>{error.digest}</strong>
              </p>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}
