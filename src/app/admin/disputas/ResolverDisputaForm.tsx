"use client";

import { useState, useTransition } from "react";
import { rejeitarDisputa, aprovarDisputa } from "./actions";
import { Campo, CampoTexto } from "@/components/ui";

/* Mesmo molde do AdminActions.tsx (verificação de profissional/distribuidora):
 * justificativa obrigatória (mín. 5 caracteres), botões desabilitados até lá,
 * useTransition pro feedback. Diferença: aprovar aqui pede também o valor a
 * reembolsar (pré-preenchido com o valor de referência, editável pra parcial). */
export function ResolverDisputaForm({ disputeId, valorReferencia }: { disputeId: string; valorReferencia: number }) {
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [valor, setValor] = useState(String(valorReferencia));

  const valorNum = Number(valor.replace(",", "."));
  const notaValida = nota.trim().length >= 5;

  function rejeitar() {
    setErro(null);
    start(async () => {
      const r = await rejeitarDisputa(disputeId, nota);
      if (!r.ok) setErro(r.error);
    });
  }

  function aprovar() {
    setErro(null);
    start(async () => {
      const r = await aprovarDisputa(disputeId, valorNum, nota);
      if (!r.ok) setErro(r.error);
    });
  }

  return (
    <div style={{ display: "grid", gap: 10, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line-soft)" }}>
      <Campo rotulo="Valor a reembolsar (R$)" value={valor} onChange={(e) => setValor(e.target.value)}
        inputMode="decimal" />
      <CampoTexto rotulo="Justificativa da decisão" value={nota} onChange={(e) => setNota(e.target.value)}
        rows={2} maxLength={500} placeholder="Explique a decisão — fica registrado na auditoria." />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary" disabled={pending || !notaValida || !(valorNum > 0)}
          onClick={aprovar} style={{ height: 38, padding: "0 16px", fontSize: 13.5 }}>
          {pending ? "Processando…" : "Aprovar reembolso"}
        </button>
        <button disabled={pending || !notaValida} onClick={rejeitar}
          style={{
            height: 38, padding: "0 16px", fontSize: 13.5, fontWeight: 600, borderRadius: 9,
            border: "1px solid var(--line)", background: "var(--surface)", color: "var(--danger)",
            cursor: pending || !notaValida ? "not-allowed" : "pointer", opacity: pending || !notaValida ? .45 : 1,
          }}>
          Rejeitar disputa
        </button>
      </div>
      {!notaValida && nota.trim().length > 0 && (
        <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>Mínimo de 5 caracteres na justificativa.</span>
      )}
      {erro && <span style={{ color: "var(--danger)", fontSize: 12.5 }}>{erro}</span>}
    </div>
  );
}
