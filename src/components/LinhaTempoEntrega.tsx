/* Linha do tempo da entrega de UMA distribuidora, no mesmo formato de
   `Rastreio.tsx` (etapas fixas, caminho inteiro visível — inclusive o que
   ainda não aconteceu). As datas vêm de `purchase_order_events`, agregados
   pela view `entregas_cliente`. */

const ETAPAS: { id: string; titulo: string }[] = [
  { id: "a_repassar", titulo: "Pedido enviado à distribuidora" },
  { id: "confirmado", titulo: "Confirmado pela distribuidora" },
  { id: "faturado", titulo: "Nota fiscal emitida" },
  { id: "enviado", titulo: "A caminho" },
  { id: "entregue", titulo: "Entregue" },
];

const ORDEM: Record<string, number> = {
  a_repassar: 0, confirmado: 1, faturado: 2, enviado: 3, entregue: 4,
};

export type EventoEntrega = { status_anterior: string; status_novo: string; created_at: string };

export function LinhaTempoEntrega({ status, eventos }: { status: string; eventos: EventoEntrega[] }) {
  if (status === "cancelado") {
    return (
      <p style={{ margin: 0, fontSize: 14, color: "var(--danger)" }}>
        Este pedido de aparelho foi cancelado.
      </p>
    );
  }

  const atual = ORDEM[status] ?? 0;
  const quandoPorEtapa: Record<string, string> = {};
  for (const ev of eventos) {
    if (!quandoPorEtapa[ev.status_novo]) quandoPorEtapa[ev.status_novo] = ev.created_at;
  }

  return (
    <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 0 }}>
      {ETAPAS.map((e, i) => {
        const concluida = atual >= ORDEM[e.id];
        const ativa = atual === ORDEM[e.id];
        const ultima = i === ETAPAS.length - 1;
        const quando = quandoPorEtapa[e.id];
        const cor = concluida ? "var(--good)" : ativa ? "var(--cool)" : "var(--line)";

        return (
          <li key={e.id} style={{ display: "grid", gridTemplateColumns: "26px 1fr", gap: 14 }}>
            <div style={{ display: "grid", justifyItems: "center", gap: 2 }}>
              <span
                aria-hidden
                style={{
                  width: 22, height: 22, borderRadius: "50%",
                  display: "grid", placeItems: "center", flexShrink: 0,
                  background: concluida ? "var(--good)" : ativa ? "var(--cool)" : "var(--surface-2)",
                  color: concluida || ativa ? "#fff" : "var(--ink-faint)",
                  border: concluida || ativa ? "none" : "1px solid var(--line)",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
              </span>
              {!ultima && <span aria-hidden style={{ width: 2, flex: 1, minHeight: 22, background: cor, opacity: concluida ? 1 : 0.4 }} />}
            </div>

            <div style={{ paddingBottom: ultima ? 0 : 18 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14.5, color: concluida || ativa ? "var(--ink)" : "var(--ink-soft)" }}>
                  {e.titulo}
                </strong>
                {ativa && (
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", padding: "2px 8px", borderRadius: 100, background: "var(--cool-wash)", color: "var(--cool-deep)" }}>
                    Agora
                  </span>
                )}
                {quando && (
                  <time style={{ fontSize: 12, color: "var(--ink-faint)" }}>
                    {new Date(quando).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </time>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
