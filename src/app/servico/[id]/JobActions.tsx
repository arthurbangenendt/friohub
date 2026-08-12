"use client";

import { useState, useTransition } from "react";
import { aceitarJob, iniciarJob, concluirJob } from "./actions";

const PROXIMO: Record<string, { label: string; fn: (id: string) => Promise<{ ok: boolean; error?: string }> }> = {
  aguardando_profissional: { label: "Aceitar serviço", fn: aceitarJob },
  aceito: { label: "Iniciar serviço", fn: iniciarJob },
  em_execucao: { label: "Marcar como concluído", fn: concluirJob },
};

export function JobActions({ jobId, status }: { jobId: string; status: string }) {
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const acao = PROXIMO[status];

  if (!acao) return null;

  return (
    <div>
      <button
        className="btn btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErro(null);
            const r = await acao.fn(jobId);
            if (!r.ok) setErro(r.error ?? "Erro.");
          })
        }
      >
        {pending ? "Salvando..." : acao.label}
      </button>
      {erro && <p style={{ color: "#b3261e", fontSize: 13.5, marginTop: 8 }}>{erro}</p>}
    </div>
  );
}
