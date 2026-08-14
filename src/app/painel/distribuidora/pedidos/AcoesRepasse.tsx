"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { avancarRepasse } from "../actions";

/* Ações do repasse, na ordem em que acontecem de verdade num dropship:
   confirmar o pedido → faturar (emitir NF) → enviar com rastreio → entregue.
   A sequência é validada também no server action; aqui ela só decide o botão. */

const PROXIMO: Record<string, { para: string; label: string } | null> = {
  a_repassar: { para: "confirmado", label: "Confirmar pedido" },
  confirmado: { para: "faturado", label: "Marcar como faturado" },
  faturado: { para: "enviado", label: "Marcar como enviado" },
  enviado: { para: "entregue", label: "Confirmar entrega" },
  entregue: null,
  cancelado: null,
};

export function AcoesRepasse({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [rastreio, setRastreio] = useState("");
  const [nf, setNf] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const proximo = PROXIMO[status];
  if (!proximo) return null;

  // Rastreio é obrigatório no envio: sem ele o cliente fica no escuro, e é a
  // pergunta que mais chega no suporte.
  const precisaRastreio = proximo.para === "enviado";
  const pedeNf = proximo.para === "faturado";

  function avancar() {
    setErro(null);
    startTransition(async () => {
      const r = await avancarRepasse(id, proximo!.para, {
        codigoRastreio: rastreio || undefined,
        notaFiscalUrl: nf || undefined,
      });
      if (!r.ok) return setErro(r.error);
      router.refresh();
    });
  }

  function cancelar() {
    setErro(null);
    startTransition(async () => {
      const r = await avancarRepasse(id, "cancelado");
      if (!r.ok) return setErro(r.error);
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
      {precisaRastreio && (
        <input value={rastreio} onChange={(e) => setRastreio(e.target.value)}
          placeholder="Código de rastreio" style={campo} />
      )}
      {pedeNf && (
        <input value={nf} onChange={(e) => setNf(e.target.value)}
          placeholder="Link da nota fiscal (opcional)" style={campo} />
      )}

      {erro && <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>{erro}</p>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={avancar} disabled={pending}
          style={{ height: 38, padding: "0 15px", fontSize: 14 }}>
          {pending ? "Salvando…" : proximo.label}
        </button>
        {status !== "enviado" && (
          <button className="btn" onClick={cancelar} disabled={pending}
            style={{ height: 38, padding: "0 15px", fontSize: 14, border: "1px solid var(--line)", background: "var(--surface)" }}>
            Cancelar pedido
          </button>
        )}
      </div>
    </div>
  );
}

const campo: React.CSSProperties = {
  width: "100%", maxWidth: 320, padding: "10px 13px", borderRadius: 10,
  border: "1px solid var(--line)", background: "var(--surface)",
  fontSize: 14, fontFamily: "inherit", color: "var(--ink)",
};
