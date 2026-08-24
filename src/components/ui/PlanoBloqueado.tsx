import { Shield } from "@/components/icons";
import { EmptyState } from "./EmptyState";

/* Nudge de upgrade para uma feature que o plano atual não libera
 * (`plano_permite`, 20260819210000_plano_permite.sql).
 *
 * Superfície de monetização, não uma trava de rollout: por isso um convite
 * pra `/planos` em vez do redirect silencioso que `ux_growth`/`ux_pipeline`
 * fazem — esconder sem explicar não vende upgrade nenhum. */
export function PlanoBloqueado({ titulo, descricao }: { titulo: string; descricao: string }) {
  return (
    <EmptyState
      icone={<Shield size={22} />}
      titulo={titulo}
      descricao={descricao}
      acao={{ label: "Ver planos", href: "/planos" }}
    />
  );
}
