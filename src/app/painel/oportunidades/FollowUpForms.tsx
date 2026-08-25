"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { concluirFollowUp, criarFollowUp, type FollowUpState } from "./actions";
import { ANALYTICS_VERSION, captureAnalytics } from "@/lib/analytics";
import { Campo, CampoSelecao } from "@/components/ui";

const inicial: FollowUpState = { ok: false, message: "" };

export function CriarFollowUpForm({ pedidoId }: { pedidoId: string }) {
  const [state, action, pending] = useActionState(criarFollowUp, inicial);
  return <form action={action} style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "end", marginTop: 10 }}>
    <input type="hidden" name="pedidoId" value={pedidoId} />
    <div style={{ flex: "1 1 145px" }}>
      <Campo rotulo="Objetivo do follow-up" rotuloOculto name="titulo" defaultValue="Retornar proposta" minLength={2} maxLength={160} />
    </div>
    <Campo rotulo="Data do follow-up" rotuloOculto name="data" type="datetime-local" required />
    <button className="btn" disabled={pending} style={{ height: 44, fontSize: 13 }}>{pending ? "Salvando…" : "Lembrar"}</button>
    {state.message && <span role="status" style={{ width: "100%", fontSize: 12, color: state.ok ? "var(--good)" : "var(--danger)" }}>{state.message}</span>}
  </form>;
}

export function ConcluirFollowUpForm({ taskId, dueAt }: { taskId: string; dueAt: string }) {
  const [state, action, pending] = useActionState(concluirFollowUp, inicial);
  const [outcome, setOutcome] = useState("contacted");
  const captured = useRef(false);
  useEffect(() => {
    if (state.ok && !captured.current) {
      captured.current = true;
      captureAnalytics("follow_up_completed", { outcome, overdue: new Date(dueAt).getTime() < Date.now(), experience_version: ANALYTICS_VERSION });
    }
  }, [dueAt, outcome, state.ok]);
  return <form action={action} style={{ display: "grid", gap: 7, marginTop: 10 }}>
    <input type="hidden" name="taskId" value={taskId} />
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "end" }}>
      <CampoSelecao rotulo="Resultado" rotuloOculto name="outcome" required value={outcome} onChange={(event) => setOutcome(event.target.value)}>
        <option value="contacted">Cliente contatado</option><option value="no_response">Sem resposta</option>
        <option value="converted">Converteu</option><option value="lost">Oportunidade perdida</option><option value="other">Outro</option>
      </CampoSelecao>
      <div style={{ flex: "1 1 180px" }}>
        <Campo rotulo="Observação" rotuloOculto name="notes" maxLength={1000} placeholder="Observação opcional" />
      </div>
      <button className="btn btn-primary" disabled={pending} style={{ height: 44, fontSize: 13 }}>{pending ? "Concluindo…" : "Concluir"}</button>
    </div>
    {state.message && <span role="status" style={{ fontSize: 12, color: state.ok ? "var(--good)" : "var(--danger)" }}>{state.message}</span>}
  </form>;
}
