"use client";

import { useState, useTransition } from "react";
import {
  ocultarReviewProfissional, restaurarReviewProfissional, ocultarReviewCliente, restaurarReviewCliente,
} from "./actions";

export function AvaliacaoActions({
  id, oculta, tipo,
}: {
  id: string;
  oculta: boolean;
  tipo: "profissional" | "cliente";
}) {
  const ocultarFn = tipo === "cliente" ? ocultarReviewCliente : ocultarReviewProfissional;
  const restaurarFn = tipo === "cliente" ? restaurarReviewCliente : restaurarReviewProfissional;
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

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
      <button
        onClick={() => run(oculta ? restaurarFn : ocultarFn)}
        disabled={desabilitado}
        style={{
          height: 36, padding: "0 14px", fontSize: 13.5, fontWeight: 600, borderRadius: 9,
          border: "1px solid var(--line)", background: "var(--surface)",
          color: oculta ? "var(--good)" : "var(--danger)",
          cursor: desabilitado ? "not-allowed" : "pointer",
          opacity: desabilitado ? .45 : 1,
        }}
      >
        {oculta ? "Restaurar" : "Ocultar"}
      </button>
      {motivo.trim().length > 0 && motivo.trim().length < 5 && (
        <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>Mínimo de 5 caracteres na justificativa.</span>
      )}
      {erro && <span style={{ color: "var(--danger)", fontSize: 12.5 }}>{erro}</span>}
    </div>
  );
}
