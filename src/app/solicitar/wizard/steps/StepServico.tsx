import { JOBS } from "../constants";
import { H } from "../shared-components";
import { cardBtn, pill } from "../styles";
import type { JobType } from "../../tipos";

export function StepServico({ onEscolher }: { onEscolher: (t: JobType) => void }) {
  return (
    <>
      <H titulo="Do que você precisa?" sub="Escolha o serviço para começarmos." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px,1fr))", gap: 12 }}>
        {JOBS.map((j) => (
          <button key={j.tipo} onClick={() => onEscolher(j.tipo)} style={cardBtn}>
            <span style={{ display: "grid", placeItems: "center", width: 42, height: 42, borderRadius: 11, background: "var(--cool-wash)", color: "var(--cool-deep)" }}><j.Icon size={22} /></span>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{j.titulo}</span>
            <span style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>{j.desc}</span>
            {j.catalogo && <span style={pill}>aparelho disponível</span>}
          </button>
        ))}
      </div>
    </>
  );
}
