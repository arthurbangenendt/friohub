"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { contestarExecucao } from "./actions";

const campo: React.CSSProperties = {
  width: "100%", marginTop: 6, padding: "11px 14px", borderRadius: 11,
  border: "1px solid var(--line)", background: "var(--surface)",
  fontSize: 14.5, fontFamily: "inherit", color: "var(--ink)", resize: "vertical",
};

/* Só existe alguma coisa a contestar quando há repasse automático em jogo —
 * hoje isso significa que a cobrança real (asaas_payments) está ligada para
 * este cliente. Nas outras regiões o botão aparece, mas a RPC responde "não
 * há repasse pendente" — não é bug, é o estado real enquanto o escrow não
 * está ativo. */
export function ContestarExecucao({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [pending, startTransition] = useTransition();

  function enviar() {
    setErro(null);
    if (motivo.trim().length < 5) {
      setErro("Descreva brevemente o que houve.");
      return;
    }
    startTransition(async () => {
      const r = await contestarExecucao(jobId, motivo);
      if (!r.ok) return setErro(r.error);
      setSucesso(true);
      setAberto(false);
      router.refresh();
    });
  }

  if (sucesso) {
    return (
      <p style={{ fontSize: 13, color: "var(--good)", fontWeight: 600, marginTop: 10 }}>
        Contestação registrada — o repasse ao profissional fica travado até o time resolver.
      </p>
    );
  }

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)}
        style={{ marginTop: 10, background: "none", border: "none", padding: 0, fontSize: 12.5, color: "var(--ink-faint)", textDecoration: "underline", cursor: "pointer" }}>
        Algo errado com este serviço?
      </button>
    );
  }

  return (
    <div style={{ marginTop: 12, padding: 14, borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface-2)" }}>
      <label>
        <span style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-soft)" }}>
          O que aconteceu? Isso trava o repasse ao profissional até o time revisar.
        </span>
        <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={500} style={campo} />
      </label>
      {erro && <p style={{ color: "var(--danger)", fontSize: 13, margin: "8px 0 0" }}>{erro}</p>}
      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <button type="button" className="btn" onClick={enviar} disabled={pending}
          style={{ background: "var(--danger-solid)", color: "#fff" }}>
          {pending ? "Enviando…" : "Contestar"}
        </button>
        <button type="button" className="btn" onClick={() => { setAberto(false); setErro(null); }} disabled={pending}
          style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
