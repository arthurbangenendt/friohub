import { MapPin, ArrowRight } from "@/components/icons";
import { hora } from "./tempo";

export type Parada = {
  jobId: string;
  starts_at: string;
  endereco: string | null;
  cidade: string;
  cep: string;
  cliente: string | null;
};

const cepFmt = (cep: string) => (/^\d{8}$/.test(cep) ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep);

const enderecoDe = (p: Parada) => [p.endereco, p.cidade, cepFmt(p.cep)].filter(Boolean).join(", ");

/* Rota única com todas as paradas do dia, na ORDEM DA AGENDA.
 *
 * Não reordenamos por proximidade de propósito: os horários foram combinados
 * com os clientes, e otimizar a rota ignorando isso faria o técnico chegar
 * atrasado no segundo atendimento para economizar deslocamento. Quem decide
 * trocar a ordem é ele, remarcando com o cliente. O que o link resolve é o
 * trabalho manual de digitar cinco endereços no aplicativo de mapa, um a um.
 *
 * O Google Maps aceita no máximo nove pontos intermediários; acima disso o
 * link é ignorado, então o botão some em vez de levar a uma tela de erro. */
const LIMITE_WAYPOINTS = 9;

function linkRota(paradas: Parada[]): string | null {
  if (paradas.length < 2) return null;
  const pontos = paradas.map(enderecoDe).filter(Boolean);
  if (pontos.length < 2 || pontos.length > LIMITE_WAYPOINTS + 2) return null;

  const origem = pontos[0];
  const destino = pontos[pontos.length - 1];
  const meio = pontos.slice(1, -1);

  const p = new URLSearchParams({ api: "1", origin: origem, destination: destino, travelmode: "driving" });
  if (meio.length) p.set("waypoints", meio.join("|"));
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}

export function Roteiro({ paradas }: { paradas: Parada[] }) {
  // Com uma parada só, a agenda já mostra o link do mapa no próprio cartão.
  if (paradas.length < 2) return null;
  const rota = linkRota(paradas);

  return (
    <section
      aria-labelledby="roteiro-titulo"
      style={{ marginTop: 26, padding: "18px 20px", borderRadius: 14, background: "var(--surface-2)", border: "1px solid var(--line)" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 id="roteiro-titulo" style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
          Roteiro do dia · {paradas.length} paradas
        </h2>
        {rota && (
          <a href={rota} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ height: 38, padding: "0 14px", fontSize: 13.5 }}>
            Abrir rota completa <ArrowRight size={15} />
          </a>
        )}
      </div>

      <ol style={{ listStyle: "none", padding: 0, margin: "14px 0 0", display: "grid", gap: 2 }}>
        {paradas.map((p, i) => (
          <li key={p.jobId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", fontSize: 13.5 }}>
            <span
              aria-hidden
              style={{
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                display: "grid", placeItems: "center",
                background: "var(--cool)", color: "#fff",
                fontSize: 11, fontWeight: 700,
              }}
            >
              {i + 1}
            </span>
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, flexShrink: 0 }}>{hora(p.starts_at)}</span>
            <span style={{ color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {p.cliente ? `${p.cliente} · ` : ""}{enderecoDe(p)}
            </span>
          </li>
        ))}
      </ol>

      {!rota && (
        <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--ink-soft)", display: "flex", alignItems: "center", gap: 6 }}>
          <MapPin size={13} />
          São paradas demais para uma rota única no mapa. Use o endereço de cada
          serviço na lista abaixo.
        </p>
      )}
    </section>
  );
}
