"use client";

import { useActionState } from "react";
import { configurarRollout, type RolloutState } from "./actions";

const initial: RolloutState = { ok: false, message: "" };
const field: React.CSSProperties = { height: 40, border: "1px solid var(--line)", borderRadius: 9, padding: "0 10px", background: "var(--surface)", color: "var(--ink)", font: "inherit" };

export function RolloutForm({ flagKey, regionSlug, enabled, rollout }: { flagKey: string; regionSlug: string; enabled: boolean; rollout: number }) {
  const [state, action, pending] = useActionState(configurarRollout, initial);
  return <form action={action} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, alignItems: "end", marginTop: 14 }}>
    <input type="hidden" name="flagKey" value={flagKey}/><input type="hidden" name="regionSlug" value={regionSlug}/>
    <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 13 }}><input type="checkbox" name="enabled" defaultChecked={enabled}/> Ativa</label>
    <label style={{ fontSize: 12, color: "var(--ink-faint)" }}>Rollout %<input name="rollout" type="number" min={0} max={100} step={1} required defaultValue={rollout} style={{ ...field, width: "100%", display: "block", marginTop: 4 }}/></label>
    <label style={{ fontSize: 12, color: "var(--ink-faint)" }}>Justificativa<input name="reason" minLength={5} maxLength={500} required placeholder="Por que o rollout está mudando?" style={{ ...field, width: "100%", display: "block", marginTop: 4 }}/></label>
    <button className="btn btn-primary" disabled={pending}>{pending ? "Salvando…" : "Aplicar"}</button>
    {state.message && <span role="status" style={{ gridColumn: "1/-1", fontSize: 12.5, color: state.ok ? "var(--good)" : "#b3261e" }}>{state.message}</span>}
  </form>;
}
