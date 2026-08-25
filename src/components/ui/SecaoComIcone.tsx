import type { ReactNode } from "react";

/* Cabeçalho de seção com ícone — mesmo molde de `.perfil-skill-icone`
 * (globals.css) já usado em profissional/[id]/page.tsx, aplicado aqui aos
 * cards de painel para dar hierarquia visual entre blocos que hoje têm todos
 * o mesmo peso. */
export function SecaoComIcone({
  icone, titulo, subtitulo, children,
}: {
  icone: ReactNode;
  titulo: string;
  subtitulo?: string;
  children: ReactNode;
}) {
  return (
    <div className="card" style={{ padding: 26, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="perfil-skill-icone">{icone}</div>
        <h2 style={{ fontSize: 16.5, fontWeight: 700, margin: 0 }}>{titulo}</h2>
      </div>
      {subtitulo && (
        <p style={{ color: "var(--ink-soft)", fontSize: 13.5, margin: "6px 0 0 48px" }}>{subtitulo}</p>
      )}
      <div style={{ marginTop: 18 }}>{children}</div>
    </div>
  );
}
