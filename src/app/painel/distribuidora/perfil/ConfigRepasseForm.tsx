"use client";

import { useState, useTransition } from "react";
import { formatarDocumento, validarDocumento } from "@/lib/documento";
import { salvarRepassePix, salvarRepasseBancario } from "../actions";
import { Campo, CampoSelecao } from "@/components/ui";

const TIPOS_PIX = [
  { id: "cpf", label: "CPF" },
  { id: "cnpj", label: "CNPJ" },
  { id: "email", label: "E-mail" },
  { id: "telefone", label: "Telefone" },
  { id: "aleatoria", label: "Chave aleatória" },
];

export type ConfigRepasseInicial = {
  metodoRepasse: "pix" | "ted" | null;
  chavePix: string;
  chavePixTipo: string;
  bancoCodigo: string;
  bancoAgencia: string;
  bancoConta: string;
  bancoContaDigito: string;
  bancoContaTipo: string;
  bancoTitularNome: string;
  bancoTitularDocumento: string;
};

/* Como a distribuidora recebe o repasse do que vende — Pix ou transferência
 * bancária (TED). Sem isto cadastrado, o repasse fica "failed" no admin até
 * ela preencher (mesmo padrão do profissional: opcional, nunca bloqueia
 * venda). Ver 20260828150000_repasse_distribuidora_pix_ted.sql. */
export function ConfigRepasseForm({ inicial }: { inicial: ConfigRepasseInicial }) {
  const [aba, setAba] = useState<"pix" | "ted">(inicial.metodoRepasse === "ted" ? "ted" : "pix");

  const [chave, setChave] = useState(inicial.chavePix);
  const [tipoPix, setTipoPix] = useState(inicial.chavePixTipo || "cpf");

  const [bancoCodigo, setBancoCodigo] = useState(inicial.bancoCodigo);
  const [agencia, setAgencia] = useState(inicial.bancoAgencia);
  const [conta, setConta] = useState(inicial.bancoConta);
  const [contaDigito, setContaDigito] = useState(inicial.bancoContaDigito);
  const [contaTipo, setContaTipo] = useState(inicial.bancoContaTipo || "conta_corrente");
  const [titularNome, setTitularNome] = useState(inicial.bancoTitularNome);
  const [titularDocumento, setTitularDocumento] = useState(formatarDocumento(inicial.bancoTitularDocumento));

  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [pending, startTransition] = useTransition();

  const documentoInvalido = titularDocumento.trim() !== "" && !validarDocumento(titularDocumento);

  function salvar() {
    setErro(null); setSalvo(false);
    startTransition(async () => {
      const r = aba === "pix"
        ? await salvarRepassePix(chave, tipoPix)
        : await salvarRepasseBancario({
            bancoCodigo, agencia, conta, contaDigito, contaTipo,
            titularNome, titularDocumento,
          });
      if (!r.ok) return setErro(r.error);
      setSalvo(true);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ fontSize: 13.5, color: "var(--ink-faint)", margin: 0 }}>
        Quando um pedido é entregue e o cliente já pagou, o repasse do que você vendeu sai automaticamente
        pra você aqui — sem essa configuração, o repasse fica pendente até você cadastrar.
      </p>

      <div style={{ display: "flex", gap: 8 }}>
        {(["pix", "ted"] as const).map((v) => (
          <button key={v} type="button" onClick={() => setAba(v)}
            style={{
              padding: "8px 16px", borderRadius: 100, cursor: "pointer", fontSize: 13.5, fontWeight: 600,
              border: `1px solid ${aba === v ? "var(--cool)" : "var(--line)"}`,
              background: aba === v ? "var(--cool)" : "var(--surface)",
              color: aba === v ? "#fff" : "var(--ink-soft)",
            }}>
            {v === "pix" ? "Pix" : "Transferência bancária (TED)"}
          </button>
        ))}
      </div>

      {aba === "pix" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12 }}>
          <CampoSelecao rotulo="Tipo de chave" value={tipoPix} onChange={(e) => setTipoPix(e.target.value)}>
            {TIPOS_PIX.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </CampoSelecao>
          <Campo rotulo="Chave Pix" value={chave} onChange={(e) => setChave(e.target.value)} placeholder="Cole sua chave aqui" />
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 12 }}>
            <Campo rotulo="Código do banco" value={bancoCodigo} onChange={(e) => setBancoCodigo(e.target.value)}
              inputMode="numeric" placeholder="Ex.: 341, 237, 001, 260" />
            <Campo rotulo="Agência" value={agencia} onChange={(e) => setAgencia(e.target.value)} inputMode="numeric" />
            <Campo rotulo="Conta" value={conta} onChange={(e) => setConta(e.target.value)} inputMode="numeric" />
            <Campo rotulo="Dígito" value={contaDigito} onChange={(e) => setContaDigito(e.target.value)} inputMode="numeric" />
          </div>
          <CampoSelecao rotulo="Tipo de conta" value={contaTipo} onChange={(e) => setContaTipo(e.target.value)}>
            <option value="conta_corrente">Conta corrente</option>
            <option value="conta_poupanca">Conta poupança</option>
          </CampoSelecao>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px,1fr))", gap: 12 }}>
            <Campo rotulo="Nome do titular da conta" value={titularNome} onChange={(e) => setTitularNome(e.target.value)} />
            <Campo rotulo="CPF/CNPJ do titular" value={titularDocumento}
              onChange={(e) => setTitularDocumento(formatarDocumento(e.target.value))}
              inputMode="numeric" erro={documentoInvalido ? "CPF ou CNPJ inválido." : null} />
          </div>
          <p style={{ fontSize: 12.5, color: "var(--ink-faint)", margin: 0 }}>
            A conta precisa ser da mesma titularidade do CNPJ cadastrado no perfil.
          </p>
        </div>
      )}

      {erro && <p style={{ color: "var(--danger)", fontSize: 14, margin: 0 }}>{erro}</p>}
      {salvo && <p style={{ color: "var(--good)", fontSize: 14, fontWeight: 600, margin: 0 }}>Forma de repasse salva!</p>}

      <div>
        <button className="btn btn-primary" onClick={salvar} disabled={pending || (aba === "ted" && documentoInvalido)}>
          {pending ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}
