"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

/* Avisos temporários.
 *
 * O projeto não tinha nenhum: depois de salvar, a tela mostrava um
 * `<span>Preferências salvas.</span>` que nunca sumia, e ações mais pesadas
 * (aceitar proposta) navegavam direto sem confirmar nada — a pessoa clica,
 * a tela troca e ela fica sem saber se deu certo.
 *
 * Fica em `aria-live="polite"` para que a confirmação seja anunciada sem
 * atropelar a leitura em curso. Erro entra como `assertive`.
 */

type Tipo = "sucesso" | "erro" | "info";
type Aviso = { id: number; tipo: Tipo; texto: string };

const Ctx = createContext<{ mostrar: (texto: string, tipo?: Tipo) => void } | null>(null);

const DURACAO = 4500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);

  const mostrar = useCallback((texto: string, tipo: Tipo = "sucesso") => {
    setAvisos((a) => [...a, { id: Date.now() + Math.random(), tipo, texto }]);
  }, []);

  const valor = useMemo(() => ({ mostrar }), [mostrar]);

  return (
    <Ctx.Provider value={valor}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: "fixed", zIndex: 100, left: 16, right: 16, bottom: 16,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
          pointerEvents: "none",
        }}
      >
        {avisos.map((a) => (
          <ItemToast key={a.id} aviso={a} aoSair={() => setAvisos((l) => l.filter((x) => x.id !== a.id))} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ItemToast({ aviso, aoSair }: { aviso: Aviso; aoSair: () => void }) {
  useEffect(() => {
    const t = setTimeout(aoSair, DURACAO);
    return () => clearTimeout(t);
  }, [aoSair]);

  const cor =
    aviso.tipo === "erro" ? { bg: "var(--danger-wash)", fg: "var(--danger)", borda: "var(--danger)" }
    : aviso.tipo === "info" ? { bg: "var(--cool-wash)", fg: "var(--cool-deep)", borda: "var(--cool)" }
    : { bg: "var(--good-wash)", fg: "var(--good)", borda: "var(--good)" };

  return (
    <div
      role={aviso.tipo === "erro" ? "alert" : "status"}
      style={{
        pointerEvents: "auto",
        maxWidth: 460, width: "fit-content",
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 16px", borderRadius: 12,
        background: cor.bg, color: cor.fg,
        border: `1px solid ${cor.borda}`,
        boxShadow: "var(--shadow-md)",
        fontSize: 14, fontWeight: 550,
      }}
    >
      <span>{aviso.texto}</span>
      <button
        onClick={aoSair}
        aria-label="Fechar aviso"
        style={{ border: "none", background: "none", color: "inherit", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 2 }}
      >
        ×
      </button>
    </div>
  );
}

/* Fora do provider devolve um no-op em vez de estourar. Um aviso que não
   aparece é um defeito visual; uma exceção derruba a árvore inteira e leva
   junto o formulário que a pessoa acabou de preencher. */
export function useToast() {
  const ctx = useContext(Ctx);
  return ctx ?? { mostrar: () => {} };
}
