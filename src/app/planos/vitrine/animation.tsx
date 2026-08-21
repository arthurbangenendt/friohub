import { useEffect, useState } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useMotionValueEvent,
  useSpring,
} from "framer-motion";

/* Primitivas de animação compartilhadas pela vitrine de planos. */

/** Respeita `prefers-reduced-motion`. Toda animação desta página passa por
 *  aqui: sem isso, quem pede menos movimento pega uma página que se mexe
 *  inteira — e, no pior caso, conteúdo preso invisível. */
export function useReduzirMovimento() {
  const [reduzir, setReduzir] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const aplicar = () => setReduzir(mq.matches);
    aplicar();
    mq.addEventListener("change", aplicar);
    return () => mq.removeEventListener("change", aplicar);
  }, []);
  return reduzir;
}

/** A página segue o cursor: um facho suave preso ao ponteiro, amortecido por
 *  mola para não grudar no pixel e parecer nervoso. */
export function FachoDoCursor({ ativo }: { ativo: boolean }) {
  const x = useMotionValue(-1000);
  const y = useMotionValue(-1000);
  const sx = useSpring(x, { stiffness: 90, damping: 26, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 90, damping: 26, mass: 0.6 });

  useEffect(() => {
    if (!ativo) return;
    const mover = (e: PointerEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
    };
    window.addEventListener("pointermove", mover, { passive: true });
    return () => window.removeEventListener("pointermove", mover);
  }, [ativo, x, y]);

  const fundo = useMotionTemplate`radial-gradient(420px circle at ${sx}px ${sy}px, color-mix(in srgb, var(--cool) 34%, transparent), transparent 72%)`;

  if (!ativo) return null;
  return <motion.div className="pl-spot" aria-hidden style={{ background: fundo }} />;
}

/** Revelação por corte vertical: cada palavra sobe de dentro de uma máscara.
 *  É o efeito de abertura de vídeo — a linha se monta em vez de aparecer. */
export function RevelaCorte({
  texto,
  atraso = 0,
  passo = 0.055,
  reduzir,
}: {
  texto: string;
  atraso?: number;
  passo?: number;
  reduzir: boolean;
}) {
  const palavras = texto.split(" ");
  if (reduzir) return <>{texto}</>;

  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", columnGap: "0.28em" }}>
      {/* O texto real fica disponível de uma vez para leitor de tela; os
          pedaços animados são decorativos. */}
      <span className="pl-sr">{texto}</span>
      {palavras.map((palavra, i) => (
        <span key={i} aria-hidden style={{ display: "inline-flex", overflow: "hidden", paddingBottom: "0.08em" }}>
          <motion.span
            style={{ display: "inline-block", willChange: "transform" }}
            initial={{ y: "110%" }}
            animate={{ y: 0 }}
            transition={{ type: "spring", stiffness: 230, damping: 30, delay: atraso + i * passo }}
          >
            {palavra}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/** Entrada padrão das seções: sobe, desfoca e assenta quando entra em tela. */
export function Revela({
  children,
  atraso = 0,
  reduzir,
  className,
}: {
  children: React.ReactNode;
  atraso?: number;
  reduzir: boolean;
  className?: string;
}) {
  if (reduzir) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.55, delay: atraso, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Número que corre até o valor. Usado no preço e no recibo — a troca
 *  mensal/anual precisa ser sentida, não só lida. */
export function Numero({ valor, reduzir, prefixo = "" }: { valor: number; reduzir: boolean; prefixo?: string }) {
  const mv = useMotionValue(valor);
  const mola = useSpring(mv, { stiffness: 120, damping: 22, mass: 0.5 });
  const [mostrado, setMostrado] = useState(valor);

  useEffect(() => {
    mv.set(valor);
  }, [valor, mv]);

  useMotionValueEvent(mola, "change", (v) => setMostrado(v));

  const n = reduzir ? valor : mostrado;
  return (
    <>
      {prefixo}
      {Math.round(n).toLocaleString("pt-BR")}
    </>
  );
}
