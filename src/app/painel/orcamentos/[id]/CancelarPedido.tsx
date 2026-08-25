"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelarPedido } from "../actions";
import { CampoTexto } from "@/components/ui";

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
        style={{ border: "1px solid var(--line)", background: "var(--surface)", color: "var(--danger)" }}
      >
        Cancelar pedido
      </button>
    );
  }

  return (
    <div className="card" style={{ padding: 18, borderColor: "#e8b4b0" }}>
      <CampoTexto
        rotulo="Por que você está cancelando?"
        value={motivo}
        onChange={(event) => setMotivo(event.target.value)}
        rows={3}
        maxLength={500}
        autoFocus
        placeholder="Ex.: decidi adiar o serviço para o próximo mês."
        dica="O motivo fica registrado no histórico e ajuda a melhorar o atendimento."
      />
      {erro && <p style={{ color: "var(--danger)", fontSize: 13, margin: "8px 0 0" }}>{erro}</p>}
      <div style={{ display: "flex", gap: 9, marginTop: 12 }}>
        <button className="btn" onClick={confirmar} disabled={pending}
          style={{ background: "var(--danger-solid)", color: "#fff" }}>
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
