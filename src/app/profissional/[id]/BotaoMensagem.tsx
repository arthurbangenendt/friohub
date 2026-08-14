"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { abrirConversa } from "@/app/painel/mensagens/actions";
import { Chat } from "@/components/icons";

/* Abre a conversa com este profissional e leva direto para a thread.
   É o caminho de "mandar mensagem antes de fechar": o cliente tira dúvida sem
   precisar criar um pedido — e sem ninguém trocar telefone. */
export function BotaoMensagem({ professionalId }: { professionalId: string }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function abrir() {
    setErro(null);
    startTransition(async () => {
      const r = await abrirConversa(professionalId);
      if (!r.ok) return setErro(r.error);
      router.push(`/painel/mensagens/${r.conversaId}`);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <button className="btn" onClick={abrir} disabled={pending}
        style={{ flexShrink: 0, gap: 8, border: "1px solid var(--line)", background: "var(--surface)" }}>
        <Chat size={17} /> {pending ? "Abrindo…" : "Enviar mensagem"}
      </button>
      {erro && <span style={{ color: "var(--danger)", fontSize: 12.5 }}>{erro}</span>}
    </div>
  );
}
