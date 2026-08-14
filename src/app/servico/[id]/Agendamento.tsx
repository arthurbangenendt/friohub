"use client";

import { useState, useTransition } from "react";
import { cancelarAgendamento, proporAgendamento, responderAgendamento } from "./actions";

export type AgendamentoView = {
  id: string;
  proposed_by: string;
  starts_at: string;
  ends_at: string;
  status: string;
  notes: string | null;
};

const campo: React.CSSProperties = {
  width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 10,
  border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)",
  fontFamily: "inherit", fontSize: 14,
};

const dataHora = (valor: string) => new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "long", timeStyle: "short",
}).format(new Date(valor));

export function Agendamento({ jobId, userId, atual }: {
  jobId: string;
  userId: string;
  atual: AgendamentoView | null;
}) {
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [motivo, setMotivo] = useState("");
  const [editando, setEditando] = useState(!atual);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fuiEu = atual?.proposed_by === userId;

  function executar(acao: () => Promise<{ ok: boolean; error?: string }>) {
    setErro(null);
    startTransition(async () => {
      const resultado = await acao();
      if (!resultado.ok) setErro(resultado.error ?? "Não foi possível salvar.");
    });
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {atual && (
        <div style={{ padding: 14, borderRadius: 12, background: "var(--surface-2)" }}>
          <strong style={{ display: "block", fontSize: 15 }}>
            {atual.status === "confirmed" ? "Horário confirmado" : "Horário proposto"}
          </strong>
          <span style={{ display: "block", color: "var(--ink-soft)", marginTop: 5, fontSize: 14 }}>
            {dataHora(atual.starts_at)} até {new Date(atual.ends_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
          {atual.notes && <p style={{ margin: "8px 0 0", color: "var(--ink-soft)", fontSize: 13.5 }}>{atual.notes}</p>}
        </div>
      )}

      {atual?.status === "proposed" && !fuiEu && (
        <div style={{ display: "grid", gap: 9 }}>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            <button className="btn btn-primary" disabled={pending}
              onClick={() => executar(() => responderAgendamento({ jobId, appointmentId: atual.id, aceitar: true }))}>
              Confirmar horário
            </button>
            <button className="btn" disabled={pending || motivo.trim().length < 3}
              onClick={() => executar(() => responderAgendamento({ jobId, appointmentId: atual.id, aceitar: false, motivo }))}
              style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
              Recusar
            </button>
          </div>
          <input value={motivo} onChange={(event) => setMotivo(event.target.value)}
            placeholder="Motivo para recusar (mínimo 3 caracteres)" style={campo} />
        </div>
      )}

      {atual && (atual.status === "confirmed" || fuiEu) && (
        <div style={{ display: "grid", gap: 8 }}>
          <input value={motivo} onChange={(event) => setMotivo(event.target.value)}
            placeholder="Motivo para cancelar (mínimo 3 caracteres)" style={campo} />
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            <button className="btn" disabled={pending || motivo.trim().length < 3}
              onClick={() => executar(() => cancelarAgendamento({ jobId, appointmentId: atual.id, motivo }))}
              style={{ border: "1px solid var(--line)", background: "var(--surface)", color: "var(--danger)" }}>
              Cancelar horário
            </button>
            {atual.status === "proposed" && (
              <button className="btn" onClick={() => setEditando(true)} disabled={pending}
                style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
                Propor outro
              </button>
            )}
          </div>
        </div>
      )}

      {editando && atual?.status !== "confirmed" && (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
            <label style={{ fontSize: 13, fontWeight: 650 }}>Início
              <input type="datetime-local" value={inicio} onChange={(event) => setInicio(event.target.value)} style={campo} />
            </label>
            <label style={{ fontSize: 13, fontWeight: 650 }}>Fim
              <input type="datetime-local" value={fim} onChange={(event) => setFim(event.target.value)} style={campo} />
            </label>
          </div>
          <label style={{ fontSize: 13, fontWeight: 650 }}>Observações
            <textarea value={observacoes} onChange={(event) => setObservacoes(event.target.value)} rows={2}
              placeholder="Acesso, preparação ou instruções importantes" style={{ ...campo, resize: "vertical" }} />
          </label>
          <button className="btn btn-primary" disabled={pending || !inicio || !fim}
            onClick={() => executar(() => proporAgendamento({ jobId, inicio, fim, observacoes }))}>
            {pending ? "Salvando…" : "Propor horário"}
          </button>
        </div>
      )}

      {erro && <p style={{ color: "var(--danger)", fontSize: 13.5, margin: 0 }}>{erro}</p>}
    </div>
  );
}
