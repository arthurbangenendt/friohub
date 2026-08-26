"use client";

import { useState, useTransition } from "react";
import { reenviarTransferencia, cancelarTransferencia } from "./actions";

/* Botões espelham exatamente o guarda-corpo da RPC — reenviar só existe pra
   quem está em "failed", cancelar só pra "pending_creation"/"failed". Não
   convida clique que o banco vai recusar. */
export function TransferenciaActions({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const podeReenviar = status === "failed";
  const podeCancelar = status === "pending_creation" || status === "failed";
  if (!podeReenviar && !podeCancelar) return null;

  function run(fn: (id: string, motivo: string) => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      setErro(null);
      const r = await fn(id, motivo);
      if (!r.ok) setErro(r.error ?? "Erro.");
      else setMotivo("");
    });
  }

  const desabilitado = pending || motivo.trim().length < 5;

  return (
    <div style={{ display: "grid", gap: 8, minWidth: 260 }}>
      <input
        value={motivo}
        onChange={(event) => setMotivo(event.target.value)}
        placeholder="Justificativa da decisão"
        aria-label="Justificativa da decisão"
        maxLength={500}
        style={{ height: 36, border: "1px solid var(--line)", borderRadius: 9, padding: "0 10px", background: "var(--surface)" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {podeReenviar && (
          <button
            className="btn btn-primary"
            disabled={desabilitado}
            onClick={() => run(reenviarTransferencia)}
            style={{ height: 36, padding: "0 14px", fontSize: 13.5 }}
          >
            Reenviar
          </button>
        )}
        {podeCancelar && (
          <button
            disabled={desabilitado}
            onClick={() => run(cancelarTransferencia)}
            style={{
              height: 36, padding: "0 14px", fontSize: 13.5, fontWeight: 600, borderRadius: 9,
              border: "1px solid var(--line)", background: "var(--surface)", color: "var(--danger)",
              cursor: desabilitado ? "not-allowed" : "pointer",
              opacity: desabilitado ? .45 : 1,
            }}
          >
            Cancelar
          </button>
        )}
      </div>
      {motivo.trim().length > 0 && motivo.trim().length < 5 && (
        <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>Mínimo de 5 caracteres na justificativa.</span>
      )}
      {erro && <span style={{ color: "var(--danger)", fontSize: 12.5 }}>{erro}</span>}
    </div>
  );
}
