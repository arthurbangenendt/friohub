import { useRef } from "react";
import { motion } from "framer-motion";
import { Check, ArrowRight } from "@/components/icons";
import { formatarBRL } from "@/lib/pricing";
import type { Ciclo } from "../actions";
import { Numero } from "./animation";
import type { PlanoDTO } from "./types";

type Beneficio = { texto: string; incluso: boolean };

const COPY: Record<string, { promessa: string; beneficios: Beneficio[] }> = {
  essencial: {
    promessa:
      "Você entra na busca da sua região e responde quantos orçamentos quiser. Sem taxa por lead.",
    beneficios: [
      { texto: "Perfil completo e visível na busca da sua região", incluso: true },
      { texto: "Orçamentos ilimitados — nada de pagar por contato", incluso: true },
      { texto: "Reputação separada por especialidade", incluso: true },
      { texto: "Financeiro básico: o que entrou em cada serviço", incluso: true },
      { texto: "Agenda do dia com cliente e endereço", incluso: false },
      { texto: "Custo por obra e lucro real", incluso: false },
      { texto: "Assistente técnico", incluso: false },
    ],
  },
  profissional: {
    promessa:
      "Além de receber serviço, você passa a saber quanto sobrou em cada obra — e quais tipos de serviço valem a sua ida.",
    beneficios: [
      { texto: "Tudo do Essencial", incluso: true },
      { texto: "Agenda do dia: serviço, cliente, endereço e detalhes", incluso: true },
      { texto: "Custo por obra — combustível, material, ajudante", incluso: true },
      { texto: "Lucro real por serviço, não só faturamento", incluso: true },
      { texto: "Gráficos de faturamento, lucro e taxa de fechamento", incluso: true },
      { texto: "1 slot patrocinado na sua especialidade", incluso: true },
      { texto: "Até 3 técnicos na conta", incluso: true },
    ],
  },
  master: {
    promessa:
      "Para empresa com equipe em campo: agenda e resultado por técnico, e um assistente que adianta a parte técnica do orçamento.",
    beneficios: [
      { texto: "Tudo do Profissional", incluso: true },
      { texto: "Assistente técnico: dimensionamento de BTU e diagnóstico", incluso: true },
      { texto: "Rascunho de orçamento gerado a partir do pedido do cliente", incluso: true },
      { texto: "Até 10 técnicos, com agenda e financeiro por técnico", incluso: true },
      { texto: "3 slots patrocinados", incluso: true },
      { texto: "Suporte prioritário", incluso: true },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Ato 2 — os planos                                                   */
/* ------------------------------------------------------------------ */

export function Alternador({
  ciclo,
  onTrocar,
  reduzir,
}: {
  ciclo: Ciclo;
  onTrocar: (c: Ciclo) => void;
  reduzir: boolean;
}) {
  return (
    <div className="pl-switch" role="group" aria-label="Ciclo de cobrança">
      {(["mensal", "anual"] as const).map((c) => (
        <button
          key={c}
          type="button"
          data-on={ciclo === c}
          aria-pressed={ciclo === c}
          onClick={() => onTrocar(c)}
        >
          {ciclo === c &&
            (reduzir ? (
              <span className="pl-switch-pill" style={{ left: 4, right: 4 }} />
            ) : (
              <motion.span
                layoutId="pl-pill"
                className="pl-switch-pill"
                style={{ left: 4, right: 4 }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            ))}
          <span style={{ position: "relative" }}>{c === "mensal" ? "Mensal" : "Anual"}</span>
          {c === "anual" && <span className="pl-economia" style={{ position: "relative" }}>2 meses grátis</span>}
        </button>
      ))}
    </div>
  );
}

export function CartaoPlano({
  plano,
  ciclo,
  reduzir,
  onAssinar,
  enviando,
}: {
  plano: PlanoDTO;
  ciclo: Ciclo;
  reduzir: boolean;
  onAssinar: (slug: string) => void;
  enviando: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const copy = COPY[plano.slug];

  // Brilho preso ao cursor dentro do cartão. Escrito em custom property para
  // o CSS pintar o gradiente sem re-renderizar o React a cada pixel.
  function mover(e: React.PointerEvent<HTMLDivElement>) {
    if (reduzir || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    ref.current.style.setProperty("--pl-x", `${e.clientX - r.left}px`);
    ref.current.style.setProperty("--pl-y", `${e.clientY - r.top}px`);
    ref.current.style.setProperty("--pl-op", "1");
  }
  function sair() {
    ref.current?.style.setProperty("--pl-op", "0");
  }

  const anual = ciclo === "anual";
  const valor = anual ? (plano.precoAnual ?? plano.precoMensal * 10) : plano.precoMensal;
  const esteEnviando = enviando === plano.slug;

  return (
    <div
      ref={ref}
      className={`pl-card${plano.destaque ? " pl-card-destaque" : ""}`}
      onPointerMove={mover}
      onPointerLeave={sair}
    >
      <span className="pl-card-brilho" aria-hidden />
      {plano.destaque && <span className="pl-selo">Mais escolhido</span>}

      <h3 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em" }}>{plano.nome}</h3>
      {plano.headline && (
        <p style={{ margin: "5px 0 18px", fontSize: 14, color: "var(--ink-soft)" }}>{plano.headline}</p>
      )}

      <div className="pl-preco">
        <span style={{ fontSize: 20, fontWeight: 700, color: "var(--ink-soft)", alignSelf: "flex-start", marginTop: 6 }}>R$</span>
        <span className="pl-preco-num">
          <Numero valor={valor} reduzir={reduzir} />
        </span>
        <span style={{ fontSize: 15, color: "var(--ink-soft)", marginLeft: 3 }}>/{anual ? "ano" : "mês"}</span>
      </div>
      <p style={{ margin: "7px 0 20px", fontSize: 13, color: "var(--ink-faint)", minHeight: 18 }}>
        {anual
          ? `Equivale a ${formatarBRL(valor / 12)} por mês`
          : `${formatarBRL(plano.precoAnual ?? plano.precoMensal * 10)} no plano anual`}
      </p>

      <button
        type="button"
        className={`btn btn-block ${plano.destaque ? "btn-primary" : "btn-ghost"}`}
        onClick={() => onAssinar(plano.slug)}
        disabled={esteEnviando}
        style={{ marginBottom: 20 }}
      >
        {esteEnviando ? "Registrando…" : "Quero este plano"}
        {!esteEnviando && <ArrowRight size={17} />}
      </button>

      {copy && (
        <>
          <p style={{ margin: "0 0 18px", fontSize: 14, lineHeight: 1.55, color: "var(--ink-soft)" }}>
            {copy.promessa}
          </p>
          <ul className="pl-feats">
            {copy.beneficios.map((b) => (
              <li key={b.texto} className={`pl-feat${b.incluso ? "" : " pl-feat-off"}`}>
                <span className="pl-feat-ico">
                  {b.incluso ? <Check size={12} /> : <span style={{ fontSize: 13, lineHeight: 1 }}>–</span>}
                </span>
                <span>{b.texto}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
