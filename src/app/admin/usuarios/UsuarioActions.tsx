"use client";

import { useState, useTransition } from "react";
import { alterarPapel, suspenderUsuario, reativarUsuario } from "./actions";

/* Duas capacidades sensíveis (trocar papel, suspender login) no mesmo card,
 * cada uma com seu próprio guarda-corpo no banco — a tela só decide QUAIS
 * botões oferecer conforme o papel atual, o resto é a RPC/edge function.
 * `souEu` esconde a linha da própria conta do admin: a RPC já recusa
 * autorrevogação, mas oferecer um botão que sempre falha é ruído. */
export function UsuarioActions({
  userId, role, suspenso, souEu,
}: {
  userId: string;
  role: string;
  suspenso: boolean;
  souEu: boolean;
}) {
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const podeAlterarPapel = !souEu && (role === "cliente" || role === "admin");
  const podeSuspender = !souEu && role === "cliente";
  if (!podeAlterarPapel && !podeSuspender) return null;

  function run(fn: (id: string, motivo: string) => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      setErro(null);
      const r = await fn(userId, motivo);
      if (!r.ok) setErro(r.error ?? "Erro.");
      else setMotivo("");
    });
  }

  const desabilitado = pending || motivo.trim().length < 5;

  return (
    <div style={{ display: "grid", gap: 8, minWidth: 280 }}>
      <input
        value={motivo}
        onChange={(event) => setMotivo(event.target.value)}
        placeholder="Justificativa da decisão"
        aria-label="Justificativa da decisão"
        maxLength={500}
        style={{ height: 36, border: "1px solid var(--line)", borderRadius: 9, padding: "0 10px", background: "var(--surface)" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {podeAlterarPapel && (
          <button
            className="btn"
            disabled={desabilitado}
            style={{ height: 36, padding: "0 14px", fontSize: 13.5 }}
            onClick={() => run((id, m) => alterarPapel(id, role === "admin" ? "cliente" : "admin", m))}
          >
            {role === "admin" ? "Revogar admin" : "Promover a admin"}
          </button>
        )}
        {podeSuspender && (
          <button
            disabled={desabilitado}
            onClick={() => run(suspenso ? reativarUsuario : suspenderUsuario)}
            style={{
              height: 36, padding: "0 14px", fontSize: 13.5, fontWeight: 600, borderRadius: 9,
              border: "1px solid var(--line)", background: "var(--surface)",
              color: suspenso ? "var(--good)" : "var(--danger)",
              cursor: desabilitado ? "not-allowed" : "pointer",
              opacity: desabilitado ? .45 : 1,
            }}
          >
            {suspenso ? "Reativar login" : "Suspender login"}
          </button>
        )}
      </div>
      {motivo.trim().length > 0 && motivo.trim().length < 5 && (
        <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>Mínimo de 5 caracteres na justificativa.</span>
      )}
      {erro && <span style={{ color: "var(--danger)", fontSize: 12.5 }}>{erro}</span>}
    </div>
  );
}
