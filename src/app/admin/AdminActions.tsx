"use client";

import { useState, useTransition } from "react";
import { aprovarProfissional, rejeitarProfissional } from "./actions";

export function AdminActions({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function run(fn: (id: string) => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      setErro(null);
      const r = await fn(id);
      if (!r.ok) setErro(r.error ?? "Erro.");
    });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {status !== "verificado" && (
        <button className="btn btn-primary" disabled={pending} style={{ height: 36, padding: "0 14px", fontSize: 13.5 }} onClick={() => run(aprovarProfissional)}>
          Aprovar
        </button>
      )}
      {status !== "rejeitado" && (
        <button disabled={pending} onClick={() => run(rejeitarProfissional)}
          style={{ height: 36, padding: "0 14px", fontSize: 13.5, fontWeight: 600, borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", color: "#b3261e", cursor: "pointer" }}>
          {status === "verificado" ? "Revogar" : "Rejeitar"}
        </button>
      )}
      {erro && <span style={{ color: "#b3261e", fontSize: 12.5 }}>{erro}</span>}
    </div>
  );
}
