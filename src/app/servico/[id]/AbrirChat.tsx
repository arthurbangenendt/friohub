"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { abrirConversa } from "@/app/painel/mensagens/actions";
import { Chat } from "@/components/icons";

/* Atalho da tela do serviço para a conversa com a outra parte.
 *
 * Sempre chama `abrir_conversa` com o id do PROFISSIONAL: a conversa é única por
 * par (cliente, profissional), então os dois lados chegam na mesma thread. Quem
 * for o profissional já terá a conversa criada pelo cliente ou pelo próprio
 * fluxo — a função devolve a existente em vez de duplicar. */
export function AbrirChat({ professionalId, rotulo }: { professionalId: string; rotulo: string }) {
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
    <div>
      <button className="btn" onClick={abrir} disabled={pending}
        style={{ gap: 8, border: "1px solid var(--line)", background: "var(--surface)" }}>
        <Chat size={17} /> {pending ? "Abrindo…" : rotulo}
      </button>
      {erro && <p style={{ color: "#b3261e", fontSize: 12.5, margin: "8px 0 0" }}>{erro}</p>}
    </div>
  );
}
