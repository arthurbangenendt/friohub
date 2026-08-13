"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { concluirFollowUp, criarFollowUp, type FollowUpState } from "./actions";
import { ANALYTICS_VERSION, captureAnalytics } from "@/lib/analytics";

const inicial: FollowUpState = { ok: false, message: "" };
const input: React.CSSProperties = { height: 38, border: "1px solid var(--line)", borderRadius: 9, padding: "0 10px", background: "var(--bg)", color: "var(--ink)", fontSize: 13 };

export function CriarFollowUpForm({ pedidoId }: { pedidoId: string }) {
  const [state, action, pending] = useActionState(criarFollowUp, inicial);
  return <form action={action} style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
    <input type="hidden" name="pedidoId" value={pedidoId} />
    <input name="titulo" aria-label="Objetivo do follow-up" defaultValue="Retornar proposta" minLength={2} maxLength={160} style={{ ...input, flex: "1 1 145px" }} />
    <input name="data" aria-label="Data do follow-up" type="datetime-local" required style={input} />
    <button className="btn" disabled={pending} style={{ height: 38, fontSize: 13 }}>{pending ? "Salvando…" : "Lembrar"}</button>
    {state.message && <span role="status" style={{ width: "100%", fontSize: 12, color: state.ok ? "var(--good)" : "#b3261e" }}>{state.message}</span>}
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
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
      <select name="outcome" required value={outcome} onChange={(event) => setOutcome(event.target.value)} style={input}>
        <option value="contacted">Cliente contatado</option><option value="no_response">Sem resposta</option>
        <option value="converted">Converteu</option><option value="lost">Oportunidade perdida</option><option value="other">Outro</option>
      </select>
      <input name="notes" aria-label="Observação" maxLength={1000} placeholder="Observação opcional" style={{ ...input, flex: "1 1 180px" }} />
      <button className="btn btn-primary" disabled={pending} style={{ height: 38, fontSize: 13 }}>{pending ? "Concluindo…" : "Concluir"}</button>
    </div>
    {state.message && <span role="status" style={{ fontSize: 12, color: state.ok ? "var(--good)" : "#b3261e" }}>{state.message}</span>}
  </form>;
}
