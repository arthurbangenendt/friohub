"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { abrirConversa } from "@/app/painel/mensagens/actions";
import { Chat } from "@/components/icons";

export function AbrirChatPedido({ pedidoId, professionalId }: { pedidoId: string; professionalId: string }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <button className="btn" disabled={pending}
        style={{ gap: 8, border: "1px solid var(--line)", background: "var(--surface)" }}
        onClick={() => startTransition(async () => {
          setErro(null);
          const resultado = await abrirConversa(professionalId, { pedidoId });
          if (!resultado.ok) return setErro(resultado.error);
          router.push(`/painel/mensagens/${resultado.conversaId}`);
        })}>
        <Chat size={17} /> {pending ? "Abrindo…" : "Conversar sobre este pedido"}
      </button>
      {erro && <p style={{ color: "#b3261e", fontSize: 12.5, margin: "8px 0 0" }}>{erro}</p>}
    </div>
  );
}
