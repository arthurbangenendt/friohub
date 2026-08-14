import { Check } from "@/components/icons";

/* Rastreio do serviço, no formato que todo mundo já conhece de entrega.
 *
 * Antes o cliente tinha só um selo de status ("Em execução") e um histórico em
 * ordem inversa, que responde "o que aconteceu" mas não "onde estou e o que
 * falta". Numa contratação de serviço em casa, a segunda pergunta é a que gera
 * ligação para o profissional.
 *
 * As etapas são fixas e derivadas do status do job, não dos eventos: o cliente
 * precisa ver o caminho inteiro desde o começo, inclusive o que ainda não
 * aconteceu. Uma trilha montada só com o que já ocorreu não mostra o que falta.
 */

export type EtapaId = "aceito" | "agendado" | "em_execucao" | "concluido" | "avaliado";

const ETAPAS: { id: EtapaId; titulo: string; descricao: string }[] = [
  { id: "aceito", titulo: "Profissional confirmado", descricao: "A proposta foi aceita e o serviço tem responsável." },
  { id: "agendado", titulo: "Data combinada", descricao: "Vocês acertaram o horário da visita." },
  { id: "em_execucao", titulo: "Serviço em andamento", descricao: "O profissional começou o atendimento." },
  { id: "concluido", titulo: "Serviço concluído", descricao: "A execução terminou e o relatório técnico fica disponível." },
  { id: "avaliado", titulo: "Avaliado", descricao: "Sua nota orienta os próximos clientes." },
];

const ORDEM: Record<string, number> = {
  aberto: -1, aguardando_profissional: -1,
  aceito: 0, em_execucao: 2, concluido: 3, avaliado: 4,
};

export function Rastreio({
  status, temAgendamento, agendamentoConfirmado, quandoPorEtapa,
}: {
  status: string;
  temAgendamento: boolean;
  agendamentoConfirmado: boolean;
  /** Data de cada etapa, quando conhecida a partir de `job_events`. */
  quandoPorEtapa: Partial<Record<EtapaId, string>>;
}) {
  if (status === "cancelado") {
    return (
      <p style={{ margin: 0, fontSize: 14, color: "var(--danger)" }}>
        Este serviço foi cancelado. O histórico abaixo mostra o que aconteceu até aqui.
      </p>
    );
  }

  const atual = ORDEM[status] ?? -1;

  return (
    <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 0 }}>
      {ETAPAS.map((e, i) => {
        /* "Data combinada" é a única etapa que não sai do status do job: um
           serviço pode estar aceito com horário ainda em negociação, e marcar
           como concluída aí seria mentira para o cliente. */
        const indice = i === 1 ? 1 : ORDEM[e.id] ?? i;
        const concluida = i === 1 ? agendamentoConfirmado || atual >= 2 : atual >= indice;
        const ativa = !concluida && (i === 1 ? atual >= 0 && temAgendamento : atual === indice - 1 || (i === 0 && atual === 0));
        const ultima = i === ETAPAS.length - 1;
        const quando = quandoPorEtapa[e.id];

        const cor = concluida ? "var(--good)" : ativa ? "var(--cool)" : "var(--line)";

        return (
          <li key={e.id} style={{ display: "grid", gridTemplateColumns: "26px 1fr", gap: 14 }}>
            {/* Marcador + linha de ligação. A linha é do próprio item para não
                depender de um pseudo-elemento posicionado de forma absoluta,
                que quebra quando o texto de uma etapa ocupa duas linhas. */}
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
                {concluida ? <Check size={13} /> : <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />}
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
              <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5 }}>
                {e.descricao}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
