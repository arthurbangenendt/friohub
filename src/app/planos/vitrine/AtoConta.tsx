import { useRef, useState } from "react";
import { motion, useMotionValueEvent, useScroll, useTransform } from "framer-motion";
import { formatarBRL } from "@/lib/pricing";
import { Numero, Revela } from "./animation";

/* ------------------------------------------------------------------ */
/* Ato 1 — a conta que ninguém faz                                     */
/* ------------------------------------------------------------------ */

const RECIBO = [
  { rot: "Instalação 12.000 BTU", val: 600, tipo: "entrada" as const },
  { rot: "Combustível (ida e volta)", val: -48, tipo: "saida" as const },
  { rot: "Material — suporte, tubo, vácuo", val: -190, tipo: "saida" as const },
  { rot: "Ajudante (meio dia)", val: -120, tipo: "saida" as const },
];
const LUCRO = RECIBO.reduce((s, l) => s + l.val, 0);

export function AtoConta({ reduzir }: { reduzir: boolean }) {
  const palco = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: palco,
    offset: ["start start", "end end"],
  });

  // Quantas linhas do recibo já apareceram, em função do scroll. O "vídeo" é
  // o próprio movimento do dedo do usuário.
  const [reveladas, setReveladas] = useState(reduzir ? RECIBO.length : 0);
  const progressoLinhas = useTransform(scrollYProgress, [0.12, 0.72], [0, RECIBO.length]);
  useMotionValueEvent(progressoLinhas, "change", (v) => {
    if (!reduzir) setReveladas(Math.max(0, Math.min(RECIBO.length, Math.floor(v))));
  });

  const [mostraTotal, setMostraTotal] = useState(reduzir);
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    if (!reduzir) setMostraTotal(v > 0.74);
  });

  const escala = useTransform(scrollYProgress, [0, 0.15], [0.94, 1]);

  const parcial = RECIBO.slice(0, reveladas).reduce((s, l) => s + l.val, 0);

  return (
    <section ref={palco} className="pl-palco" style={{ height: reduzir ? "auto" : "260vh" }}>
      <div className="pl-sticky">
        <div className="container" style={{ display: "grid", gap: 44, gridTemplateColumns: "1fr", justifyItems: "center" }}>
          <Revela reduzir={reduzir}>
            <h2 className="pl-batida" style={{ textAlign: "center", margin: 0 }}>
              Você sabe quanto faturou.
              <br />
              <span style={{ color: "var(--cool)" }}>Sabe quanto sobrou?</span>
            </h2>
          </Revela>

          <motion.div className="pl-recibo" style={reduzir ? undefined : { scale: escala }}>
            <div style={{ fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-faint)", marginBottom: 6 }}>
              Uma obra real, linha a linha
            </div>

            {RECIBO.map((linha, i) => (
              <motion.div
                key={linha.rot}
                className="pl-recibo-linha"
                initial={reduzir ? false : { opacity: 0, x: -12 }}
                animate={reduzir || i < reveladas ? { opacity: 1, x: 0 } : { opacity: 0.12, x: -12 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className="pl-recibo-rot">{linha.rot}</span>
                <span
                  className="pl-recibo-val"
                  style={{ color: linha.tipo === "entrada" ? "var(--good)" : "var(--ink)" }}
                >
                  {linha.val < 0 ? "− " : "+ "}
                  {formatarBRL(Math.abs(linha.val))}
                </span>
              </motion.div>
            ))}

            <div className="pl-recibo-total">
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>
                {mostraTotal ? "Lucro real" : "Somando…"}
              </span>
              <span style={{ fontSize: 27, fontWeight: 800, letterSpacing: "-0.03em", color: mostraTotal ? "var(--good)" : "var(--ink-faint)" }}>
                R$ <Numero valor={mostraTotal ? LUCRO : parcial} reduzir={reduzir} />
              </span>
            </div>

            <p style={{ margin: "14px 0 0", fontSize: 13, lineHeight: 1.55, color: "var(--ink-soft)" }}>
              Seiscentos reais na nota viram {formatarBRL(LUCRO)} no bolso. É essa diferença
              que decide se vale atravessar a cidade — e é ela que o FrioHub calcula sozinho.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
