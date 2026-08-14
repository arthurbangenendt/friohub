"use client";

import Link from "next/link";
import { useEffect } from "react";

/* Rede de segurança para tudo que está fora de `/painel` — home, wizard de
   solicitação, perfil público, páginas do serviço. Mesma regra de lá: a
   mensagem crua do banco não vai para a tela, só o `digest` de correlação. */
export default function ErroGlobal({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app]", error);
  }, [error]);

  return (
    <main id="conteudo" style={{ minHeight: "70dvh", display: "grid", placeItems: "center", padding: "60px 24px" }}>
      <div style={{ maxWidth: 520, textAlign: "center" }}>
        <h1 style={{ fontSize: "1.8rem", fontWeight: 800, letterSpacing: "-0.025em" }}>
          Algo deu errado por aqui
        </h1>
        <p style={{ color: "var(--ink-soft)", marginTop: 12, lineHeight: 1.6 }}>
          A falha foi registrada e nada do que você enviou foi perdido. Tente de
          novo em instantes.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 26, justifyContent: "center", flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={reset}>Tentar de novo</button>
          <Link href="/" className="btn btn-ghost">Ir para o início</Link>
        </div>
        {error.digest && (
          <p style={{ marginTop: 22, fontSize: 12.5, color: "var(--ink-soft)" }}>
            Código para o suporte: <strong>{error.digest}</strong>
          </p>
        )}
      </div>
    </main>
  );
}
