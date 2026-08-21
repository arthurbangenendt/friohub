import { useState } from "react";
import { ArrowRight } from "@/components/icons";
import { formatarBRL } from "@/lib/pricing";
import type { Ciclo } from "../actions";
import type { PlanoDTO } from "./types";

/* ------------------------------------------------------------------ */
/* Checkout — a hora em que o Asaas entra em cena                      */
/* ------------------------------------------------------------------ */

/** Só dígitos, e só aceita 11 (CPF) ou 14 (CNPJ) — o Asaas recusa qualquer
 *  outra coisa na criação do customer, então validar aqui evita ida e volta
 *  ao servidor por um erro que dava para pegar na hora. */
function formatarDocumento(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 11) {
    return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return d
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export function ModalCheckout({
  plano,
  ciclo,
  valor,
  precisaDocumento,
  enviando,
  erro,
  onFechar,
  onConfirmar,
}: {
  plano: PlanoDTO;
  ciclo: Ciclo;
  valor: number;
  precisaDocumento: boolean;
  enviando: boolean;
  erro: string | null;
  onFechar: () => void;
  onConfirmar: (documento: string) => void;
}) {
  const [documento, setDocumento] = useState("");
  const digitos = documento.replace(/\D/g, "");
  const documentoValido = !precisaDocumento || digitos.length === 11 || digitos.length === 14;

  return (
    <div
      className="pl-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onFechar();
      }}
    >
      <div className="pl-modal" role="dialog" aria-modal="true" aria-labelledby="pl-modal-titulo">
        <button type="button" className="pl-modal-fechar" onClick={onFechar} aria-label="Fechar">
          ×
        </button>

        <span className="pl-eyebrow" style={{ color: "var(--cool)" }}>
          Plano {plano.nome} · {ciclo === "mensal" ? "mensal" : "anual"}
        </span>
        <h3 id="pl-modal-titulo" style={{ margin: "6px 0 4px", fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>
          {formatarBRL(valor)} {ciclo === "mensal" ? "/mês" : "/ano"}
        </h3>
        <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.55, color: "var(--ink-soft)" }}>
          Você será redirecionado para o <strong>Asaas</strong>, nosso parceiro de pagamentos, para
          concluir com Pix, boleto ou cartão. O FrioHub não guarda dado de cartão.
        </p>

        {precisaDocumento && (
          <label style={{ display: "block", marginBottom: 18 }}>
            <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "var(--ink)" }}>
              CPF ou CNPJ
            </span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={formatarDocumento(documento)}
              onChange={(e) => setDocumento(e.target.value)}
              placeholder="000.000.000-00"
              className="pl-modal-input"
            />
            <span style={{ display: "block", fontSize: 12, marginTop: 6, color: "var(--ink-faint)" }}>
              Pedimos isso só na primeira assinatura — é exigido pelo gateway de pagamento.
            </span>
          </label>
        )}

        {erro && (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: "10px 14px",
              borderRadius: 10,
              fontSize: 13.5,
              background: "var(--danger-wash)",
              color: "var(--danger)",
            }}
          >
            {erro}
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={enviando || !documentoValido}
          onClick={() => onConfirmar(digitos)}
        >
          {enviando ? "Abrindo pagamento…" : "Ir para pagamento"}
          {!enviando && <ArrowRight size={17} />}
        </button>
      </div>
    </div>
  );
}

/* Quem já assina troca de plano — não é o mesmo fluxo de assinar pela
 * primeira vez: sem CPF (já cadastrado), sem valor fixo (upgrade cobra a
 * diferença proporcional, calculada pelo backend; downgrade não cobra nada
 * agora). Por isso não reaproveita o preço do cartão — o texto é deliberadamente
 * menos específico até a confirmação. */
export function ModalTrocaPlano({
  plano,
  ehUpgrade,
  enviando,
  erro,
  onFechar,
  onConfirmar,
}: {
  plano: PlanoDTO;
  ehUpgrade: boolean;
  enviando: boolean;
  erro: string | null;
  onFechar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <div
      className="pl-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onFechar();
      }}
    >
      <div className="pl-modal" role="dialog" aria-modal="true" aria-labelledby="pl-troca-titulo">
        <button type="button" className="pl-modal-fechar" onClick={onFechar} aria-label="Fechar">
          ×
        </button>

        <span className="pl-eyebrow" style={{ color: "var(--cool)" }}>
          {ehUpgrade ? "Upgrade" : "Downgrade"} de plano
        </span>
        <h3 id="pl-troca-titulo" style={{ margin: "6px 0 14px", fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>
          Trocar para o {plano.nome}
        </h3>

        {ehUpgrade ? (
          <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.55, color: "var(--ink-soft)" }}>
            Você paga agora só a diferença proporcional aos dias que faltam do seu ciclo atual — não é o valor cheio
            do plano novo. O <strong>Asaas</strong> mostra o valor exato antes de confirmar o pagamento.
          </p>
        ) : (
          <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.55, color: "var(--ink-soft)" }}>
            Sem cobrança agora. Você continua no plano atual até o fim do ciclo já pago — o {plano.nome} passa a
            valer a partir do próximo vencimento.
          </p>
        )}

        {erro && (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: "10px 14px",
              borderRadius: 10,
              fontSize: 13.5,
              background: "var(--danger-wash)",
              color: "var(--danger)",
            }}
          >
            {erro}
          </div>
        )}

        <button type="button" className="btn btn-primary btn-block" disabled={enviando} onClick={onConfirmar}>
          {enviando ? "Confirmando…" : ehUpgrade ? "Ir para pagamento" : "Confirmar downgrade"}
          {!enviando && <ArrowRight size={17} />}
        </button>
      </div>
    </div>
  );
}
