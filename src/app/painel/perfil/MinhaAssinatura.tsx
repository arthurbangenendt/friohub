"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { formatarBRL } from "@/lib/pricing";
import { cancelarAssinatura } from "./actions";

export type AssinaturaDTO = {
  planoNome: string;
  ciclo: "mensal" | "anual";
  valor: number;
  status: "pending_first_payment" | "active" | "overdue";
  autoRenova: boolean;
  proximoVencimento: string | null;
};

const STATUS_LABEL: Record<AssinaturaDTO["status"], string> = {
  pending_first_payment: "Aguardando pagamento",
  active: "Ativo",
  overdue: "Pagamento atrasado",
};

function formatarData(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");
}

export function MinhaAssinatura({ assinatura }: { assinatura: AssinaturaDTO | null }) {
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, startTransition] = useTransition();
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  if (!assinatura) {
    return (
      <div className="card" style={{ padding: 26, marginTop: 16 }}>
        <div style={{ fontSize: 12.5, fontWeight: 650, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)", marginBottom: 4 }}>
          Minha assinatura
        </div>
        <p style={{ color: "var(--ink-soft)", fontSize: 14, margin: "10px 0 14px" }}>
          Você ainda não tem um plano pago.
        </p>
        <Link href="/planos" className="btn btn-ghost" style={{ height: 36, padding: "0 13px", fontSize: 13.5 }}>
          Ver planos
        </Link>
      </div>
    );
  }

  function confirmarCancelamento() {
    setAviso(null);
    startTransition(async () => {
      const r = await cancelarAssinatura();
      setConfirmando(false);
      if (r.ok) {
        setAviso({ tipo: "ok", texto: "Assinatura cancelada." });
      } else {
        setAviso({ tipo: "erro", texto: r.erro });
      }
    });
  }

  const jaCancelada = !assinatura.autoRenova;

  return (
    <div className="card" style={{ padding: 26, marginTop: 16 }}>
      <div style={{ fontSize: 12.5, fontWeight: 650, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)", marginBottom: 4 }}>
        Minha assinatura
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, margin: "10px 0 4px" }}>
        <span style={{ fontSize: 18, fontWeight: 700 }}>
          Plano {assinatura.planoNome} · {formatarBRL(assinatura.valor)}/{assinatura.ciclo === "mensal" ? "mês" : "ano"}
        </span>
        <span
          style={{
            fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 100,
            background: assinatura.status === "overdue" ? "var(--warning-wash)" : "var(--good-wash)",
            color: assinatura.status === "overdue" ? "var(--warning)" : "var(--good)",
          }}
        >
          {STATUS_LABEL[assinatura.status]}
        </span>
      </div>

      {assinatura.proximoVencimento && (
        <p style={{ color: "var(--ink-soft)", fontSize: 13.5, margin: "0 0 14px" }}>
          {jaCancelada
            ? `Cancelamento agendado — acesso continua até ${formatarData(assinatura.proximoVencimento)}.`
            : `Próxima cobrança em ${formatarData(assinatura.proximoVencimento)}.`}
        </p>
      )}
      {!assinatura.proximoVencimento && assinatura.status === "pending_first_payment" && (
        <p style={{ color: "var(--ink-soft)", fontSize: 13.5, margin: "0 0 14px" }}>
          Ainda não há cobrança liquidada para este plano.
        </p>
      )}

      {aviso && (
        <div
          role="status"
          style={{
            marginBottom: 14, padding: "10px 14px", borderRadius: 10, fontSize: 13.5,
            background: aviso.tipo === "ok" ? "var(--cool-wash)" : "var(--danger-wash)",
            color: aviso.tipo === "ok" ? "var(--ink)" : "var(--danger)",
          }}
        >
          {aviso.texto}
        </div>
      )}

      {!jaCancelada && (
        confirmando ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>Tem certeza?</span>
            <button type="button" className="btn btn-ghost" disabled={enviando} onClick={confirmarCancelamento} style={{ height: 34, padding: "0 12px", fontSize: 13, color: "var(--danger)" }}>
              {enviando ? "Cancelando…" : "Sim, cancelar"}
            </button>
            <button type="button" className="btn btn-ghost" disabled={enviando} onClick={() => setConfirmando(false)} style={{ height: 34, padding: "0 12px", fontSize: 13 }}>
              Voltar
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmando(true)} style={{ height: 34, padding: "0 12px", fontSize: 13 }}>
            Cancelar assinatura
          </button>
        )
      )}
    </div>
  );
}
