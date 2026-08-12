"use client";

import { useMemo, useState } from "react";
import { calcularBtu, formatarBtu } from "@/lib/btu";

/* Mesma função que roda no fluxo do cliente (lib/btu), aqui como ferramenta de
   bancada: o profissional confere a capacidade na visita sem depender de um
   pedido aberto. Um cálculo só, um lugar só — se a regra mudar, muda nos dois. */
export function CalculadoraBtu() {
  const [areaM2, setAreaM2] = useState(20);
  const [numPessoas, setNumPessoas] = useState(2);
  const [eletronicos, setEletronicos] = useState(1);
  const [insolacaoAlta, setInsolacaoAlta] = useState(false);
  const [andarOuTelhado, setAndarOuTelhado] = useState(false);

  const btu = useMemo(
    () => calcularBtu({ areaM2, numPessoas, insolacaoAlta, andarOuTelhado, eletronicos }),
    [areaM2, numPessoas, insolacaoAlta, andarOuTelhado, eletronicos],
  );

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px,1fr))", gap: "0 20px" }}>
        <Campo label={`Área: ${areaM2} m²`}>
          <input type="range" min={6} max={120} value={areaM2} onChange={(e) => setAreaM2(+e.target.value)} style={{ width: "100%" }} />
        </Campo>
        <Campo label={`Pessoas: ${numPessoas}`}>
          <input type="range" min={1} max={20} value={numPessoas} onChange={(e) => setNumPessoas(+e.target.value)} style={{ width: "100%" }} />
        </Campo>
        <Campo label={`Eletrônicos que esquentam: ${eletronicos}`}>
          <input type="range" min={0} max={10} value={eletronicos} onChange={(e) => setEletronicos(+e.target.value)} style={{ width: "100%" }} />
        </Campo>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9, margin: "4px 0 16px" }}>
        <Check label="Ambiente pega muito sol" checked={insolacaoAlta} onChange={setInsolacaoAlta} />
        <Check label="Último andar / laje exposta" checked={andarOuTelhado} onChange={setAndarOuTelhado} />
      </div>

      <div style={{ padding: "18px 20px", borderRadius: 12, background: "var(--cool-wash)", border: "1px solid var(--line)" }}>
        <div style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-faint)", fontWeight: 700 }}>
          Capacidade recomendada
        </div>
        <div style={{ fontSize: "1.7rem", fontWeight: 800, color: "var(--cool-deep)", margin: "4px 0 10px" }}>
          {formatarBtu(btu.btuRecomendado)}
        </div>
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
          {btu.detalhe.map((d) => (
            <div key={d.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--ink-soft)" }}>
              <span>{d.label}</span>
              <span>+{d.valor.toLocaleString("pt-BR")}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 700, marginTop: 3 }}>
            <span>Carga térmica estimada</span>
            <span>{btu.btuCalculado.toLocaleString("pt-BR")} BTU/h</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-soft)" }}>{label}</span>
      {children}
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14, color: "var(--ink-soft)" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, accentColor: "var(--cool)" }} />
      {label}
    </label>
  );
}
