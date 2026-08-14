"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

export function VerticalCutReveal({
  children,
  className,
  staggerDuration = .07,
}: {
  children: ReactNode;
  className?: string;
  staggerDuration?: number;
}) {
  const texto = typeof children === "string" ? children : String(children ?? "");
  const palavras = texto.split(/\s+/).filter(Boolean);
  const reduzirMovimento = useReducedMotion();

  return (
    <span className={className}>
      <span className="sr-only">{texto}</span>
      <span aria-hidden="true" className="vcr-linha">
        {palavras.map((palavra, indice) => (
          <span className="vcr-corte" key={`${palavra}-${indice}`}>
            <motion.span
              className="vcr-palavra"
              initial={reduzirMovimento ? false : { y: "105%" }}
              animate={{ y: 0 }}
              transition={{
                type: "spring",
                stiffness: 220,
                damping: 28,
                delay: reduzirMovimento ? 0 : .12 + indice * staggerDuration,
              }}
            >
              {palavra}
            </motion.span>
          </span>
        ))}
      </span>
    </span>
  );
}
