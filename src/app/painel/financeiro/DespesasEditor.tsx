"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatarBRL } from "@/lib/pricing";
import { registrarDespesa, removerDespesa } from "./actions";
import { CATEGORIAS_DESPESA } from "./categorias";

export type Despesa = {
  id: string;
  categoria: string;
  descricao: string | null;
  valor: number;
  data: string;
};

const LABEL = Object.fromEntries(CATEGORIAS_DESPESA.map((c) => [c.id, c.label]));
const hoje = () => new Date().toISOString().slice(0, 10);

/* `inicial` é a fonte da verdade, sem cópia em estado local: guardar a lista em
   useState congelava o valor da montagem, e o router.refresh() atualizava os
   KPIs do servidor enquanto a lista continuava mostrando o estado antigo. */
export function DespesasEditor({ inicial: lista }: { inicial: Despesa[] }) {
  const router = useRouter();
  const [categoria, setCategoria] = useState<string>("deslocamento");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(hoje());
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const valorNum = Number(valor.replace(",", "."));
  const podeSalvar = valorNum > 0 && !Number.isNaN(valorNum);

  function salvar() {
    setErro(null);
    start(async () => {
      const r = await registrarDespesa({ categoria, descricao, valor: valorNum, data });
      if (!r.ok) { setErro(r.error); return; }
      setDescricao(""); setValor("");
      router.refresh();
    });
  }

  function remover(id: string) {
    start(async () => {
      const r = await removerDespesa(id);
      if (!r.ok) { setErro(r.error); return; }
      router.refresh();
    });
  }

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, alignItems: "end" }}>
        <label style={campo}>
          <span style={rotulo}>Categoria</span>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={input}>
            {CATEGORIAS_DESPESA.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label style={campo}>
          <span style={rotulo}>Descrição</span>
          <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: gás R410A" style={input} />
        </label>
        <label style={campo}>
          <span style={rotulo}>Valor (R$)</span>
          <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" style={input} />
        </label>
        <label style={campo}>
          <span style={rotulo}>Data</span>
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={input} />
        </label>
        <button onClick={salvar} disabled={!podeSalvar || pending} className="btn btn-primary"
          style={{ height: 40, fontSize: 14, opacity: podeSalvar ? 1 : 0.55 }}>
          {pending ? "Salvando..." : "Lançar"}
        </button>
      </div>

      {erro && <p style={{ color: "var(--danger)", fontSize: 13.5, marginTop: 10 }}>{erro}</p>}

      {lista.length === 0 ? (
        <p style={{ color: "var(--ink-faint)", fontSize: 13.5, marginTop: 18 }}>
          Nenhuma despesa lançada. Registrar gasolina, gás e peça é o que transforma faturamento em lucro real.
        </p>
      ) : (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
          {lista.map((d) => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)" }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 100, background: "var(--surface-2)", color: "var(--ink-soft)", whiteSpace: "nowrap" }}>
                {LABEL[d.categoria] ?? d.categoria}
              </span>
              <span style={{ flex: 1, fontSize: 13.5, color: "var(--ink-soft)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {d.descricao || "—"}
              </span>
              <span style={{ fontSize: 12, color: "var(--ink-faint)", whiteSpace: "nowrap" }}>
                {new Date(d.data + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
              </span>
              <strong style={{ fontSize: 14, whiteSpace: "nowrap" }}>{formatarBRL(d.valor)}</strong>
              <button onClick={() => remover(d.id)} aria-label="Remover despesa"
                style={{ border: "none", background: "none", color: "var(--ink-faint)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const campo: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const rotulo: React.CSSProperties = { fontSize: 12.5, fontWeight: 650, color: "var(--ink-soft)" };
const input: React.CSSProperties = { height: 40, padding: "0 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: 14, width: "100%" };
