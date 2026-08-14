"use client";

import { useState, useTransition } from "react";
import {
  aprovarDistribuidora, aprovarProfissional, rejeitarDistribuidora, rejeitarProfissional,
} from "./actions";

/* Serve profissional e distribuidora: os dois fluxos de verificação são o mesmo
   par aprovar/rejeitar, e o que muda é só a tabela alvo. */
export function AdminActions({
  id, status, tipo = "profissional",
}: {
  id: string;
  status: string;
  tipo?: "profissional" | "distribuidora";
}) {
  const aprovar = tipo === "distribuidora" ? aprovarDistribuidora : aprovarProfissional;
  const rejeitar = tipo === "distribuidora" ? rejeitarDistribuidora : rejeitarProfissional;
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  function run(fn: (id: string, motivo: string) => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      setErro(null);
      const r = await fn(id, motivo);
      if (!r.ok) setErro(r.error ?? "Erro.");
    });
  }

  return (
    <div style={{ display: "grid", gap: 8, minWidth: 280 }}>
      <input
        value={motivo}
        onChange={(event) => setMotivo(event.target.value)}
        placeholder="Justificativa da decisão"
        aria-label="Justificativa da decisão"
        maxLength={500}
        style={{ height: 36, border: "1px solid var(--line)", borderRadius: 9, padding: "0 10px", background: "var(--surface)" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {status !== "verificado" && (
          <button className="btn btn-primary" disabled={pending || motivo.trim().length < 5} style={{ height: 36, padding: "0 14px", fontSize: 13.5 }} onClick={() => run(aprovar)}>
            Aprovar
          </button>
        )}
        {status !== "rejeitado" && (
          <button disabled={pending || motivo.trim().length < 5} onClick={() => run(rejeitar)}
            style={{ height: 36, padding: "0 14px", fontSize: 13.5, fontWeight: 600, borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--danger)", cursor: "pointer" }}>
            {status === "verificado" ? "Revogar" : "Rejeitar"}
          </button>
        )}
      </div>
      {erro && <span style={{ color: "var(--danger)", fontSize: 12.5 }}>{erro}</span>}
    </div>
  );
}
