"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Alert } from "@/components/ui";

/* Antes não existia nenhum `error.tsx` no projeto: qualquer erro não tratado
   numa página do painel caía na tela de erro genérica do Next, fora do shell,
   sem navegação e sem caminho de volta.
 *
 * A mensagem crua não vai para a tela de propósito — `error.message` aqui vem do
 * Postgres/Supabase e diria coisas como "new row violates row-level security
 * policy", que não ajuda o usuário e expõe a estrutura interna. O `digest` é o
 * que liga esta tela à linha correspondente no log do servidor. */
export default function ErroPainel({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[painel]", error);
  }, [error]);

  return (
    <div style={{ maxWidth: 620, margin: "0 auto", padding: "72px 28px" }}>
      <h1 style={{ fontSize: "1.6rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
        Não foi possível carregar esta tela
      </h1>
      <p style={{ color: "var(--ink-soft)", marginTop: 10, lineHeight: 1.6 }}>
        A falha foi registrada. Seus dados não foram alterados — nada do que você
        já tinha enviado se perdeu.
      </p>

      <div style={{ display: "flex", gap: 10, marginTop: 24, flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={reset}>Tentar de novo</button>
        <Link href="/painel" className="btn btn-ghost">Voltar ao painel</Link>
      </div>

      {error.digest && (
        <Alert tipo="info" style={{ marginTop: 26 }}>
          Se precisar falar com o suporte, informe este código: <strong>{error.digest}</strong>
        </Alert>
      )}
    </div>
  );
}
