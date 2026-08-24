"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatarDocumento, validarDocumento } from "@/lib/documento";
import { salvarCpfCnpjCliente } from "./actions";

const campo: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 7 };
const rotulo: React.CSSProperties = { fontSize: 13.5, fontWeight: 650, color: "var(--ink-soft)" };
const input: React.CSSProperties = { height: 44, padding: "0 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: 15, width: "100%" };

/* CPF/CNPJ do cliente — necessário pro Asaas abrir o pagador na hora de
 * cobrar o serviço. Coleta única, igual à regra do backend
 * (salvarCpfCnpjSeAusente): uma vez salvo, não tem como editar por aqui —
 * mudar depois de vinculado ao gateway trocaria a identidade do pagador de
 * uma cobrança que já pode estar em aberto. */
export function CpfCnpjCliente({ cpfCnpjInicial }: { cpfCnpjInicial: string | null }) {
  const router = useRouter();
  const [valor, setValor] = useState("");
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const invalido = valor.trim() !== "" && !validarDocumento(valor);

  function salvar() {
    setErro(null);
    start(async () => {
      const r = await salvarCpfCnpjCliente(valor);
      if (r.ok) router.refresh();
      else setErro(r.error);
    });
  }

  return (
    <div style={campo}>
      <span style={rotulo}>CPF ou CNPJ</span>
      {cpfCnpjInicial ? (
        <>
          <div style={{ ...input, display: "flex", alignItems: "center", color: "var(--ink-soft)" }}>
            {formatarDocumento(cpfCnpjInicial)}
          </div>
          <span style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>
            Documento usado pra abrir cobranças no Asaas — não pode ser trocado por aqui.
          </span>
        </>
      ) : (
        <>
          <input value={valor} onChange={(e) => setValor(formatarDocumento(e.target.value))}
            inputMode="numeric" placeholder="000.000.000-00" style={input} />
          <span style={{ fontSize: 12.5, color: invalido ? "var(--danger)" : "var(--ink-faint)" }}>
            {invalido ? "CPF ou CNPJ inválido." : "Necessário para pagar um serviço pela plataforma."}
          </span>
          {erro && <p style={{ color: "var(--danger)", fontSize: 14, margin: 0 }}>{erro}</p>}
          <button type="button" className="btn btn-primary" onClick={salvar}
            disabled={pending || !valor || invalido}
            style={{ alignSelf: "flex-start", height: 40, padding: "0 18px", opacity: pending ? 0.7 : 1 }}>
            {pending ? "Salvando..." : "Salvar"}
          </button>
        </>
      )}
    </div>
  );
}
