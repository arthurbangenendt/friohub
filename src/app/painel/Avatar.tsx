import type { CSSProperties } from "react";

// Paleta estável para o avatar de fallback. A cor sai do id, então a mesma
// pessoa tem sempre a mesma cor — muda de cor a cada render seria ruído visual.
const CORES = ["#2E6F8E", "#2E8B6F", "#8E5A2E", "#6F4E8E", "#8E2E4F", "#2E4F8E"];

export function corDoId(id: string): string {
  let soma = 0;
  for (let i = 0; i < id.length; i++) soma = (soma + id.charCodeAt(i)) % 997;
  return CORES[soma % CORES.length];
}

export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/* Avatar com fallback em bloco colorido + iniciais — o mesmo tratamento usado
   nos cards de profissional. Sem foto, o bloco continua identificando a pessoa
   em vez de mostrar um ícone genérico igual para todo mundo. */
export function Avatar({
  nome, id, url, size = 38, radius = "50%", fontSize,
}: {
  nome: string;
  id: string;
  url?: string | null;
  size?: number;
  radius?: string;
  fontSize?: number;
}) {
  const estilo: CSSProperties = {
    width: size, height: size, borderRadius: radius, flexShrink: 0, overflow: "hidden",
    display: "grid", placeItems: "center", color: "#fff", fontWeight: 700,
    fontSize: fontSize ?? Math.round(size * 0.4),
    background: url ? "var(--surface-2)" : corDoId(id),
  };

  return (
    <span style={estilo} aria-hidden={false} role="img" aria-label={nome}>
      {url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={url} alt={nome} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : iniciais(nome)}
    </span>
  );
}
