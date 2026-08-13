"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelarPedido } from "../actions";

export function CancelarPedido({ pedidoId }: { pedidoId: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmar() {
    setErro(null);
    if (motivo.trim().length < 5) {
      setErro("Explique o motivo em pelo menos cinco caracteres.");
      return;
    }

    startTransition(async () => {
      const resultado = await cancelarPedido(pedidoId, motivo);
      if (!resultado.ok) return setErro(resultado.error);
      router.refresh();
    });
  }

  if (!aberto) {
    return (
      <button
        className="btn"
        onClick={() => setAberto(true)}
        style={{ border: "1px solid var(--line)", background: "var(--surface)", color: "#b3261e" }}
      >
        Cancelar pedido
      </button>
    );
  }

  return (
    <div className="card" style={{ padding: 18, borderColor: "#e8b4b0" }}>
      <label style={{ display: "block", fontSize: 13, fontWeight: 650, color: "var(--ink-soft)" }}>
        Por que você está cancelando?
        <textarea
          value={motivo}
          onChange={(event) => setMotivo(event.target.value)}
          rows={3}
          maxLength={500}
          autoFocus
          placeholder="Ex.: decidi adiar o serviço para o próximo mês."
          style={{
            width: "100%", marginTop: 7, padding: "11px 14px", borderRadius: 11,
            border: "1px solid var(--line)", background: "var(--surface)",
            fontSize: 14, fontFamily: "inherit", color: "var(--ink)", resize: "vertical",
          }}
        />
      </label>
      <p style={{ margin: "7px 0 0", fontSize: 12.5, color: "var(--ink-faint)" }}>
        O motivo fica registrado no histórico e ajuda a melhorar o atendimento.
      </p>
      {erro && <p style={{ color: "#b3261e", fontSize: 13, margin: "8px 0 0" }}>{erro}</p>}
      <div style={{ display: "flex", gap: 9, marginTop: 12 }}>
        <button className="btn" onClick={confirmar} disabled={pending}
          style={{ background: "#b3261e", color: "white" }}>
          {pending ? "Cancelando…" : "Confirmar cancelamento"}
        </button>
        <button className="btn" onClick={() => { setAberto(false); setErro(null); }} disabled={pending}
          style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
          Voltar
        </button>
      </div>
    </div>
  );
}
