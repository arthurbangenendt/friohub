"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatarBRL } from "@/lib/pricing";
import { enviarOrcamentoFinal, aprovarOrcamentoFinal, recusarOrcamentoFinal } from "./actions";
import { Campo, CampoTexto } from "@/components/ui";

export type PendenteView = {
  id: string;
  valor_servico: number;
  observacoes: string | null;
};

/* Orçamento do serviço, lançado pelo profissional depois da visita técnica.
 *
 * O valor da visita já foi cobrado no aceite da proposta e não é abatido nem
 * editável aqui — só aparece como referência para o cliente ver o total. Se o
 * cliente recusar, o job continua aguardando_orcamento_final e o profissional
 * pode reenviar outro valor (negociação, sem cancelar o serviço).
 */
export function OrcamentoFinal({
  jobId,
  isPro,
  valorVisita,
  pendente,
  ultimoRecusado,
  podeEnviar,
}: {
  jobId: string;
  isPro: boolean;
  valorVisita: number;
  pendente: PendenteView | null;
  ultimoRecusado: { valor_servico: number; motivo_recusa: string | null } | null;
  podeEnviar: boolean;
}) {
  const router = useRouter();
  const [valor, setValor] = useState("");
  const [obs, setObs] = useState("");
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const num = (s: string) => Number(s.replace(/\./g, "").replace(",", ".")) || 0;

  if (isPro) {
    if (!podeEnviar) return null;
    return (
      <div style={{ display: "grid", gap: 12 }}>
        {ultimoRecusado && (
          <div style={{ padding: "10px 14px", borderRadius: 11, background: "var(--danger-wash)", fontSize: 13.5 }}>
            O cliente recusou {formatarBRL(ultimoRecusado.valor_servico)}
            {ultimoRecusado.motivo_recusa ? `: "${ultimoRecusado.motivo_recusa}"` : "."} Envie um novo valor.
          </div>
        )}
        <p style={{ fontSize: 13.5, color: "var(--ink-faint)", margin: 0 }}>
          O valor da visita ({formatarBRL(valorVisita)}) já é seu, à parte. Informe agora o valor do
          serviço em si para o cliente aprovar.
        </p>
        <Campo rotulo="Valor do serviço (R$)" value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" />
        <CampoTexto rotulo="Observações (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} rows={2} />
        {erro && <p style={{ color: "var(--danger)", fontSize: 13.5, margin: 0 }}>{erro}</p>}
        <button
          className="btn btn-primary"
          disabled={pending}
          style={{ justifySelf: "start" }}
          onClick={() => {
            setErro(null);
            if (num(valor) <= 0) {
              setErro("Informe um valor válido.");
              return;
            }
            start(async () => {
              const r = await enviarOrcamentoFinal({ jobId, valorServico: num(valor), observacoes: obs });
              if (!r.ok) return setErro(r.error);
              router.refresh();
            });
          }}
        >
          {pending ? "Enviando…" : "Enviar orçamento do serviço"}
        </button>
      </div>
    );
  }

  // Cliente: só há o que fazer quando existe um orçamento pendente de resposta.
  if (!pendente) return null;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gap: 8, fontSize: 14.5 }}>
        <Linha k="Visita técnica" v={formatarBRL(valorVisita)} />
        <Linha k="Serviço" v={formatarBRL(pendente.valor_servico)} />
        <Linha k={<strong>Total</strong>} v={<strong>{formatarBRL(valorVisita + pendente.valor_servico)}</strong>} />
      </div>
      {pendente.observacoes && (
        <p style={{ fontSize: 13.5, color: "var(--ink-soft)", margin: 0 }}>{pendente.observacoes}</p>
      )}

      {recusando && (
        <div style={{ padding: 15, borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface-2)" }}>
          <CampoTexto
            rotulo="Por que você está recusando? (opcional)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            maxLength={500}
            autoFocus
          />
          <div style={{ display: "flex", gap: 9, marginTop: 10 }}>
            <button
              className="btn"
              disabled={pending}
              style={{ background: "var(--danger-solid)", color: "#fff" }}
              onClick={() => {
                setErro(null);
                start(async () => {
                  const r = await recusarOrcamentoFinal({ jobId, jobFinalQuoteId: pendente.id, motivo });
                  if (!r.ok) return setErro(r.error);
                  router.refresh();
                });
              }}
            >
              {pending ? "Registrando…" : "Confirmar recusa"}
            </button>
            <button
              className="btn"
              disabled={pending}
              style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
              onClick={() => { setRecusando(false); setErro(null); }}
            >
              Voltar
            </button>
          </div>
        </div>
      )}

      {erro && <p style={{ color: "var(--danger)", fontSize: 13.5, margin: 0 }}>{erro}</p>}

      {!recusando && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            className="btn btn-primary"
            disabled={pending}
            onClick={() => {
              setErro(null);
              start(async () => {
                const r = await aprovarOrcamentoFinal({ jobId, jobFinalQuoteId: pendente.id });
                if (!r.ok) return setErro(r.error);
                router.refresh();
              });
            }}
          >
            {pending ? "Aprovando…" : "Aprovar e iniciar o serviço"}
          </button>
          <button
            className="btn"
            disabled={pending}
            style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
            onClick={() => setRecusando(true)}
          >
            Recusar
          </button>
        </div>
      )}
    </div>
  );
}

function Linha({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
      <span style={{ color: "var(--ink-faint)" }}>{k}</span>
      <span style={{ textAlign: "right" }}>{v}</span>
    </div>
  );
}
