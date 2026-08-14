import type { CSSProperties } from "react";

/* Blocos de carregamento. Não são genéricos de propósito: um esqueleto que não
   tem o formato do conteúdo real produz um "pulo" no layout quando os dados
   chegam, o que é pior do que tela parada. Por isso existem variações prontas
   com a forma das telas que o app realmente tem. */

export function Skeleton({
  largura = "100%", altura = 14, radius = 8, style,
}: { largura?: number | string; altura?: number | string; radius?: number; style?: CSSProperties }) {
  return <div className="skel" aria-hidden style={{ width: largura, height: altura, borderRadius: radius, ...style }} />;
}

/** Cartão de KPI — usado nos painéis de cliente, profissional e distribuidora. */
export function SkeletonKpi() {
  return (
    <div style={{ padding: "16px 18px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--line)" }}>
      <Skeleton largura={72} altura={10} />
      <Skeleton largura={110} altura={24} style={{ marginTop: 10 }} />
    </div>
  );
}

/** Linha da lista de serviços/pedidos: bloco de texto à esquerda, selo à direita. */
export function SkeletonLinha() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--line)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Skeleton largura="42%" altura={15} />
        <Skeleton largura="65%" altura={12} style={{ marginTop: 8 }} />
        <Skeleton largura="30%" altura={12} style={{ marginTop: 6 }} />
      </div>
      <Skeleton largura={96} altura={24} radius={100} />
    </div>
  );
}

/** Esqueleto padrão de uma página do painel: cabeçalho, KPIs e uma lista. */
export function SkeletonPainel({ kpis = 4, linhas = 3 }: { kpis?: number; linhas?: number }) {
  return (
    /* `aria-busy` + texto para leitor de tela: sem isso o carregamento é
       completamente silencioso para quem não enxerga a animação. */
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 28px 80px" }} aria-busy="true">
      <span className="sr-only" role="status">Carregando…</span>
      <Skeleton largura={120} altura={12} />
      <Skeleton largura={280} altura={30} style={{ marginTop: 12 }} />
      {kpis > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 28 }}>
          {Array.from({ length: kpis }, (_, i) => <SkeletonKpi key={i} />)}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 36 }}>
        {Array.from({ length: linhas }, (_, i) => <SkeletonLinha key={i} />)}
      </div>
    </div>
  );
}

/** Esqueleto de formulário — perfil, preferências, cadastro de equipamento. */
export function SkeletonFormulario({ campos = 5 }: { campos?: number }) {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 28px 80px" }} aria-busy="true">
      <span className="sr-only" role="status">Carregando…</span>
      <Skeleton largura={120} altura={12} />
      <Skeleton largura={240} altura={30} style={{ marginTop: 12 }} />
      <div className="card" style={{ padding: 22, marginTop: 28, display: "grid", gap: 18 }}>
        {Array.from({ length: campos }, (_, i) => (
          <div key={i}>
            <Skeleton largura={90} altura={11} />
            <Skeleton altura={44} radius={10} style={{ marginTop: 7 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
