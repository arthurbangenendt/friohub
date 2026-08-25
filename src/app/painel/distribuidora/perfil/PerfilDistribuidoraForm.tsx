"use client";

import { useState, useTransition } from "react";
import { formatarDocumento, validarDocumento } from "@/lib/documento";
import { ESTADO } from "@/lib/regiao";
import { salvarPerfilDistribuidora } from "../actions";
import { Campo } from "@/components/ui";

const rotulo: React.CSSProperties = { fontSize: 13, fontWeight: 650, color: "var(--ink-soft)", display: "block", marginBottom: 6 };

// UFs mais prováveis primeiro; o dropship raramente sai do eixo no início.
const UFS = ["SP", "RJ", "MG", "PR", "SC", "RS", "ES", "GO", "DF", "BA", "PE", "CE"];

export function PerfilDistribuidoraForm({
  inicial,
}: {
  inicial: { razaoSocial: string; cnpj: string; cidade: string; prazoEntregaDias: number; ufs: string[] };
}) {
  const [razaoSocial, setRazaoSocial] = useState(inicial.razaoSocial);
  const [cnpj, setCnpj] = useState(formatarDocumento(inicial.cnpj));
  const [cidade, setCidade] = useState(inicial.cidade);
  const [prazo, setPrazo] = useState(String(inicial.prazoEntregaDias));
  const [ufs, setUfs] = useState<string[]>(inicial.ufs);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [pending, startTransition] = useTransition();

  const cnpjInvalido = cnpj.trim() !== "" && !validarDocumento(cnpj);

  function toggleUf(uf: string) {
    setUfs((cur) => (cur.includes(uf) ? cur.filter((x) => x !== uf) : [...cur, uf]));
  }

  function salvar() {
    setErro(null); setSalvo(false);
    startTransition(async () => {
      const r = await salvarPerfilDistribuidora({
        razaoSocial, cnpj, cidade,
        prazoEntregaDias: Number(prazo) || 5,
        ufsAtendidas: ufs,
      });
      if (!r.ok) return setErro(r.error);
      setSalvo(true);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Campo rotulo="Razão social" value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 12 }}>
        <Campo rotulo="CNPJ" value={cnpj} onChange={(e) => setCnpj(formatarDocumento(e.target.value))} inputMode="numeric"
          erro={cnpjInvalido ? "CNPJ inválido." : null} />
        <Campo rotulo="Cidade da operação" value={cidade} onChange={(e) => setCidade(e.target.value)} />
        <Campo rotulo="Prazo de entrega (dias úteis)" value={prazo} onChange={(e) => setPrazo(e.target.value)} inputMode="numeric" />
      </div>

      <div>
        <span style={rotulo}>Estados em que você entrega</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {UFS.map((uf) => {
            const on = ufs.includes(uf);
            return (
              <button key={uf} type="button" onClick={() => toggleUf(uf)}
                style={{
                  padding: "7px 13px", borderRadius: 100, cursor: "pointer", fontSize: 13.5, fontWeight: 600,
                  border: `1px solid ${on ? "var(--cool)" : "var(--line)"}`,
                  background: on ? "var(--cool)" : "var(--surface)",
                  color: on ? "#fff" : "var(--ink-soft)",
                }}>
                {uf}
              </button>
            );
          })}
        </div>
        <span style={{ fontSize: 12.5, color: "var(--ink-faint)", display: "block", marginTop: 8 }}>
          Sem nenhum estado marcado, entendemos que você entrega em toda a praça atendida ({ESTADO}).
        </span>
      </div>

      {erro && <p style={{ color: "var(--danger)", fontSize: 14, margin: 0 }}>{erro}</p>}
      {salvo && <p style={{ color: "var(--good)", fontSize: 14, fontWeight: 600, margin: 0 }}>Perfil salvo!</p>}

      <div>
        <button className="btn btn-primary" onClick={salvar} disabled={pending || cnpjInvalido}>
          {pending ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}
