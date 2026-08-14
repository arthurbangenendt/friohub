import type { CSSProperties, ReactNode } from "react";

type Tipo = "erro" | "aviso" | "sucesso" | "info";

const ESTILO: Record<Tipo, { cor: string; bg: string; borda: string }> = {
  erro: { cor: "var(--danger)", bg: "var(--danger-wash)", borda: "var(--danger)" },
  aviso: { cor: "var(--warning)", bg: "var(--warning-wash)", borda: "var(--warning)" },
  sucesso: { cor: "var(--good)", bg: "var(--good-wash)", borda: "var(--good)" },
  info: { cor: "var(--cool-deep)", bg: "var(--cool-wash)", borda: "var(--cool)" },
};

/* Mensagem de estado de um formulário ou de uma página.
 *
 * Existe sobretudo por acessibilidade: o padrão anterior era
 * `<p style={{color:"#b3261e"}}>{erro}</p>` repetido em ~15 componentes, sem
 * `role` nenhum. Quem usa leitor de tela enviava o formulário, a submissão
 * falhava e nada era anunciado — a pessoa ficava sem saber por que não avançou.
 *
 * `role="alert"` interrompe e anuncia na hora (certo para falha); os demais
 * usam `role="status"`, que espera a leitura corrente terminar. */
export function Alert({
  tipo = "erro", titulo, children, style,
}: { tipo?: Tipo; titulo?: string; children: ReactNode; style?: CSSProperties }) {
  const e = ESTILO[tipo];
  return (
    <div
      role={tipo === "erro" ? "alert" : "status"}
      style={{
        display: "flex", flexDirection: "column", gap: 3,
        padding: "12px 14px", borderRadius: 11,
        background: e.bg, color: e.cor,
        borderLeft: `3px solid ${e.borda}`,
        fontSize: 13.5, lineHeight: 1.5,
        ...style,
      }}
    >
      {titulo && <strong style={{ fontSize: 13.5 }}>{titulo}</strong>}
      <span style={{ color: tipo === "info" ? "var(--ink-soft)" : e.cor }}>{children}</span>
    </div>
  );
}

/** Versão enxuta para colar embaixo de um campo ou de um botão. */
export function MensagemErro({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  if (!children) return null;
  return (
    <p role="alert" style={{ color: "var(--danger)", fontSize: 13, margin: 0, ...style }}>
      {children}
    </p>
  );
}
