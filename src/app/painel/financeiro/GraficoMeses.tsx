"use client";

import { useState } from "react";
import { formatarBRL } from "@/lib/pricing";

export type PontoMes = { mes: string; receita: number; despesa: number };

const SERIES = [
  { chave: "receita" as const, label: "Recebido", cor: "var(--chart-1)" },
  { chave: "despesa" as const, label: "Despesas", cor: "var(--chart-2)" },
];

/* Barras agrupadas por mês: duas séries de mesma unidade (R$), então um eixo só.
   Marca fina, topo arredondado apenas na ponta do dado, 2px de respiro entre as
   barras do par. Grade recessiva. Valor exato no hover — rótulo em toda barra
   viraria ruído com 6 meses × 2 séries. */
export function GraficoMeses({ dados, comDespesa = true }: { dados: PontoMes[]; comDespesa?: boolean }) {
  const [ativo, setAtivo] = useState<number | null>(null);

  /* Cliente não tem despesa — a série seria uma linha de zeros para sempre.
     Com uma série só, o título nomeia o dado e a legenda desaparece. */
  const series = comDespesa ? SERIES : SERIES.slice(0, 1);
  const max = Math.max(1, ...dados.flatMap((d) => (comDespesa ? [d.receita, d.despesa] : [d.receita])));
  const alturaPlot = 148;
  const linhas = [0, 0.5, 1];

  if (dados.every((d) => d.receita === 0 && (!comDespesa || d.despesa === 0))) {
    return (
      <p style={{ color: "var(--ink-faint)", fontSize: 14, margin: "18px 0 0" }}>
        Nada lançado ainda. Assim que houver serviço concluído ou despesa registrada, o mês aparece aqui.
      </p>
    );
  }

  return (
    <div>
      {/* Duas séries exigem legenda; uma só é nomeada pelo título da seção */}
      {series.length > 1 && (
      <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
        {series.map((s) => (
          <span key={s.chave} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--ink-soft)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.cor }} />
            {s.label}
          </span>
        ))}
      </div>
      )}

      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", height: alturaPlot, position: "relative" }}>
          {/* grade recessiva */}
          {linhas.map((f) => (
            <span key={f} aria-hidden style={{
              position: "absolute", left: 0, right: 0, bottom: f * alturaPlot,
              borderTop: "1px solid var(--line)", opacity: f === 0 ? 1 : 0.6,
            }} />
          ))}

          {dados.map((d, i) => (
            <div key={d.mes} style={{ flex: 1, display: "flex", gap: 2, alignItems: "flex-end", height: "100%", position: "relative", zIndex: 1 }}
              onMouseEnter={() => setAtivo(i)} onMouseLeave={() => setAtivo(null)}>
              {series.map((s) => {
                const v = d[s.chave];
                return (
                  <span key={s.chave} title={`${s.label}: ${formatarBRL(v)}`}
                    style={{
                      flex: 1,
                      height: Math.max(v > 0 ? 3 : 0, (v / max) * alturaPlot),
                      background: s.cor,
                      borderRadius: "4px 4px 0 0",
                      opacity: ativo === null || ativo === i ? 1 : 0.45,
                      transition: "opacity .12s ease",
                    }} />
                );
              })}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          {dados.map((d, i) => (
            <span key={d.mes} style={{
              flex: 1, textAlign: "center", fontSize: 11.5,
              color: ativo === i ? "var(--ink)" : "var(--ink-faint)",
              fontWeight: ativo === i ? 650 : 500,
            }}>{d.mes}</span>
          ))}
        </div>

        {ativo !== null && (
          <div style={{
            marginTop: 12, padding: "10px 14px", borderRadius: 10,
            background: "var(--surface-2)", fontSize: 13, display: "flex", gap: 18, flexWrap: "wrap",
          }}>
            <strong>{dados[ativo].mes}</strong>
            {series.map((s) => (
              <span key={s.chave} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--ink-soft)" }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: s.cor }} />
                {s.label}: <strong style={{ color: "var(--ink)" }}>{formatarBRL(dados[ativo][s.chave])}</strong>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
