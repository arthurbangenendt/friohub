import type { Estado } from "@/lib/status";
import { resolver } from "@/lib/status";

const mono = "var(--font-geist-mono), ui-monospace, monospace";

/* Selo de estado. Recebe o mapa (`STATUS_JOB`, `STATUS_REPASSE`…) e a chave
   crua vinda do banco, e resolve cor e rótulo por `@/lib/status` — ou seja, é
   impossível uma tela nova inventar a própria cor de "Concluído". */
export function StatusPill({
  mapa, valor, tamanho = "m",
}: {
  mapa: Record<string, Estado>;
  valor: string | null | undefined;
  tamanho?: "s" | "m";
}) {
  const e = resolver(mapa, valor);
  return (
    <span
      style={{
        fontFamily: mono,
        fontSize: tamanho === "s" ? 11 : 12,
        padding: tamanho === "s" ? "3px 9px" : "5px 11px",
        borderRadius: 100,
        background: e.bg,
        color: e.cor,
        whiteSpace: "nowrap",
      }}
    >
      {e.label}
    </span>
  );
}
