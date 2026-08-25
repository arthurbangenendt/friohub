"use client";

import { useState, useTransition } from "react";
import { salvarChavePix, type TipoChavePix } from "./actions";
import { Campo, CampoSelecao } from "@/components/ui";

const TIPOS: { valor: TipoChavePix; label: string }[] = [
  { valor: "cpf", label: "CPF" },
  { valor: "cnpj", label: "CNPJ" },
  { valor: "email", label: "E-mail" },
  { valor: "telefone", label: "Telefone" },
  { valor: "aleatoria", label: "Chave aleatória" },
];

/* Chave PIX de destino do repasse automático — ver ADR do escrow. Sem ela
 * cadastrada, o job conclui normalmente mas o repasse fica pendente até o
 * profissional preencher isto aqui. */
export function ChavePix({ inicial }: { inicial: { chavePix: string; chavePixTipo: TipoChavePix } | null }) {
  const [tipo, setTipo] = useState<TipoChavePix>(inicial?.chavePixTipo ?? "cpf");
  const [chave, setChave] = useState(inicial?.chavePix ?? "");
  const [editando, setEditando] = useState(!inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [pending, startTransition] = useTransition();

  function salvar() {
    setErro(null);
    setSucesso(false);
    startTransition(async () => {
      const r = await salvarChavePix(chave, tipo);
      if (!r.ok) return setErro(r.error);
      setSucesso(true);
      setEditando(false);
    });
  }

  return (
    <div className="card" style={{ padding: 26, marginTop: 16 }}>
      <div style={{ fontSize: 12.5, fontWeight: 650, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)", marginBottom: 4 }}>
        Chave PIX
      </div>
      <p style={{ color: "var(--ink-soft)", fontSize: 14, marginBottom: 16 }}>
        É pra onde o repasse do seu serviço vai quando o pagamento pela plataforma estiver ativo. Sem chave cadastrada, o repasse fica pendente.
      </p>

      {!editando && inicial ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>
              {TIPOS.find((t) => t.valor === inicial.chavePixTipo)?.label ?? inicial.chavePixTipo}
            </span>
            <div style={{ fontWeight: 600, fontSize: 14.5 }}>{inicial.chavePix}</div>
          </div>
          <button type="button" className="btn" onClick={() => setEditando(true)}
            style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
            Trocar
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <CampoSelecao rotulo="Tipo de chave" value={tipo} onChange={(e) => setTipo(e.target.value as TipoChavePix)}>
            {TIPOS.map((t) => <option key={t.valor} value={t.valor}>{t.label}</option>)}
          </CampoSelecao>
          <Campo
            rotulo="Chave PIX"
            value={chave}
            onChange={(e) => setChave(e.target.value)}
            placeholder={tipo === "cpf" || tipo === "cnpj" ? "Só números" : "Digite a chave"}
          />
          {erro && <p style={{ color: "var(--danger)", fontSize: 13.5, margin: 0 }}>{erro}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="btn btn-primary" onClick={salvar} disabled={pending}>
              {pending ? "Salvando…" : "Salvar chave PIX"}
            </button>
            {inicial && (
              <button type="button" className="btn" onClick={() => { setEditando(false); setErro(null); }} disabled={pending}
                style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}
      {sucesso && !editando && (
        <p style={{ color: "var(--good)", fontSize: 13.5, marginTop: 10, fontWeight: 600 }}>Chave PIX salva.</p>
      )}
    </div>
  );
}
