import type { CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/* Campo de formulário.
 *
 * Havia seis definições concorrentes do mesmo input no projeto — `Field` em
 * (auth)/ui.tsx, `campo` em PropostaForm, `campoAceite` em Propostas, `input` no
 * wizard, `field` em EquipmentForm e um objeto inline em desempenho/clientes —
 * com alturas (44 vs 42) e raios (11 vs 10 vs 9) diferentes. Numa mesma tela dá
 * para ver dois inputs de tamanhos distintos.
 *
 * O rótulo é obrigatório na assinatura, e é intencional: as telas mais novas
 * (EquipmentForm, desempenho, clientes) usavam só `placeholder`, que some quando
 * a pessoa começa a digitar e não é lido de forma confiável por leitor de tela.
 * Se o rótulo precisa ficar oculto no visual, use `rotuloOculto` — aí ele
 * continua existindo para a tecnologia assistiva. */

export const controle: CSSProperties = {
  width: "100%",
  minHeight: 44,
  padding: "11px 14px",
  borderRadius: 10,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--ink)",
  fontSize: 15,
  fontFamily: "inherit",
};

const rotuloStyle: CSSProperties = {
  fontSize: 13, fontWeight: 650, color: "var(--ink-soft)", display: "block", marginBottom: 6,
};

function Envolve({
  rotulo, rotuloOculto, dica, erro, children,
}: { rotulo: string; rotuloOculto?: boolean; dica?: ReactNode; erro?: string | null; children: ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={rotuloStyle} className={rotuloOculto ? "sr-only" : undefined}>{rotulo}</span>
      {children}
      {dica && !erro && (
        <span style={{ display: "block", fontSize: 12.5, color: "var(--ink-soft)", marginTop: 5 }}>{dica}</span>
      )}
      {erro && (
        <span role="alert" style={{ display: "block", fontSize: 12.5, color: "var(--danger)", marginTop: 5 }}>{erro}</span>
      )}
    </label>
  );
}

type Comum = { rotulo: string; rotuloOculto?: boolean; dica?: ReactNode; erro?: string | null };

export function Campo({ rotulo, rotuloOculto, dica, erro, style, ...props }: Comum & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Envolve rotulo={rotulo} rotuloOculto={rotuloOculto} dica={dica} erro={erro}>
      <input
        {...props}
        aria-invalid={erro ? true : undefined}
        style={{ ...controle, ...(erro ? { borderColor: "var(--danger)" } : null), ...style }}
      />
    </Envolve>
  );
}

export function CampoTexto({ rotulo, rotuloOculto, dica, erro, style, rows = 3, ...props }: Comum & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Envolve rotulo={rotulo} rotuloOculto={rotuloOculto} dica={dica} erro={erro}>
      <textarea
        {...props}
        rows={rows}
        aria-invalid={erro ? true : undefined}
        style={{ ...controle, resize: "vertical", ...(erro ? { borderColor: "var(--danger)" } : null), ...style }}
      />
    </Envolve>
  );
}

export function CampoSelecao({ rotulo, rotuloOculto, dica, erro, style, children, ...props }: Comum & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Envolve rotulo={rotulo} rotuloOculto={rotuloOculto} dica={dica} erro={erro}>
      <select {...props} aria-invalid={erro ? true : undefined} style={{ ...controle, ...style }}>
        {children}
      </select>
    </Envolve>
  );
}
