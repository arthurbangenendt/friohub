"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { solicitarCancelamentoJobPago } from "./actions";
import { CampoTexto } from "@/components/ui";

/* Cliente pede cancelamento + reembolso de um job já pago mas ainda em
 * andamento (ex.: profissional não apareceu). Não cancela nada na hora — só
 * abre uma disputa que o admin resolve em /admin/disputas; o job continua
 * normal até lá. */
export function CancelarJobPago({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirmar() {
    setErro(null);
    if (motivo.trim().length < 5) {
      setErro("Explique o que aconteceu em pelo menos cinco caracteres.");
      return;
    }
    startTransition(async () => {
      const resultado = await solicitarCancelamentoJobPago(jobId, motivo);
      if (!resultado.ok) return setErro(resultado.error);
      setEnviado(true);
      router.refresh();
    });
  }

  if (enviado) {
    return (
      <p style={{ fontSize: 13.5, color: "var(--ink-soft)", marginTop: 10 }}>
        Cancelamento solicitado — nossa equipe vai revisar e você recebe uma resposta em breve.
      </p>
    );
  }

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)}
        style={{ marginTop: 10, background: "none", border: "none", padding: 0, fontSize: 12.5, color: "var(--ink-faint)", textDecoration: "underline", cursor: "pointer" }}>
        Precisa cancelar este serviço?
      </button>
    );
  }

  return (
    <div style={{ marginTop: 12, padding: 14, borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface-2)" }}>
      <CampoTexto
        rotulo="O que aconteceu? Você já pagou por este serviço — se aprovado, o valor é reembolsado."
        value={motivo}
        onChange={(event) => setMotivo(event.target.value)}
        rows={3}
        maxLength={500}
        autoFocus
        placeholder="Ex.: o profissional não apareceu no horário combinado."
      />
      {erro && <p style={{ color: "var(--danger)", fontSize: 13, margin: "8px 0 0" }}>{erro}</p>}
      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <button type="button" className="btn" onClick={confirmar} disabled={pending}
          style={{ background: "var(--danger-solid)", color: "#fff" }}>
          {pending ? "Enviando…" : "Solicitar cancelamento e reembolso"}
        </button>
        <button type="button" className="btn" onClick={() => { setAberto(false); setErro(null); }} disabled={pending}
          style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
          Voltar
        </button>
      </div>
    </div>
  );
}
