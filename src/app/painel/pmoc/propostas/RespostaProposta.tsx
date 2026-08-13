"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { responderProposta } from "../propor/actions";

export function RespostaProposta({ planId }: { planId: string }) {
  const router = useRouter();
  const [enviando, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState("");

  function responder(aceitar: boolean) {
    setErro(null);
    start(async () => {
      const r = await responderProposta(planId, aceitar, motivo);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div style={{ marginTop: 16 }}>
      {erro && (
        <p role="alert" style={{ margin: "0 0 12px", padding: "11px 14px", borderRadius: 10, background: "var(--warm-wash)", fontSize: 14 }}>
          {erro}
        </p>
      )}

      {recusando ? (
        <div style={{ display: "grid", gap: 10 }}>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            placeholder="Motivo da recusa (opcional) — ajuda o profissional a ajustar a proposta"
            style={{
              width: "100%", padding: "10px 12px", borderRadius: 10, resize: "vertical",
              border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)",
              fontSize: 14, fontFamily: "inherit",
            }}
          />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost" onClick={() => responder(false)} disabled={enviando}>
              {enviando ? "Enviando…" : "Confirmar recusa"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setRecusando(false)} disabled={enviando}>
              Voltar
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={() => responder(true)} disabled={enviando}>
            {enviando ? "Aceitando…" : "Aceitar e ativar o contrato"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setRecusando(true)} disabled={enviando}>
            Recusar
          </button>
        </div>
      )}
    </div>
  );
}
