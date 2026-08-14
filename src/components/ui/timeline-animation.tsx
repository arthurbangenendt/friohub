"use client";

import { motion, useInView, useReducedMotion } from "framer-motion";
import { useRef, type ReactNode } from "react";

export function TimelineContent({
  children,
  className,
  delay = 0,
  amount = 0.18,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  amount?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const visivel = useInView(ref, { once: true, amount });
  const reduzirMovimento = useReducedMotion();

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={reduzirMovimento ? false : { opacity: 0, y: 22, filter: "blur(8px)" }}
      animate={visivel || reduzirMovimento ? { opacity: 1, y: 0, filter: "blur(0px)" } : undefined}
      transition={{ duration: .55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
