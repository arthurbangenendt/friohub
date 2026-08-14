"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { formatarBRL } from "@/lib/pricing";

export interface ExpenseItem {
  category: string;
  amount: number;
  color: string;
}

export interface WeeklyExpenseCardProps {
  title: string;
  dateRange: string;
  data: ExpenseItem[];
  buttonText?: string;
  onButtonClick?: () => void;
  className?: string;
}

/**
 * Adaptação do card de referência: mantém a entrada animada do gráfico e a
 * legenda em blocos, mas usa os tokens visuais e a moeda do FrioHub.
 */
export function WeeklyExpenseCard({
  title,
  dateRange,
  data,
  buttonText,
  onButtonClick,
  className = "",
}: WeeklyExpenseCardProps) {
  const total = React.useMemo(
    () => data.reduce((sum, item) => sum + item.amount, 0),
    [data],
  );
  const segmentos = React.useMemo(() => {
    const ativos = data.filter((item) => item.amount > 0);
    return ativos.map((item, index) => {
      const percentage = total > 0 ? (item.amount / total) * 100 : 0;
      const offset = total > 0
        ? ativos.slice(0, index).reduce((sum, anterior) => sum + (anterior.amount / total) * 100, 0)
        : 0;
      return { ...item, percentage, offset };
    });
  }, [data, total]);

  return (
    <article
      className={`w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)] ${className}`}
    >
      <header className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-extrabold tracking-tight text-[var(--ink)]">{title}</h3>
          <p className="mt-0.5 text-sm text-[var(--ink-faint)]">{dateRange}</p>
        </div>
        {buttonText && onButtonClick && (
          <button
            type="button"
            onClick={onButtonClick}
            className="rounded-full px-3 py-1.5 text-sm font-semibold text-[var(--cool)] transition-colors hover:bg-[var(--cool-wash)]"
          >
            {buttonText}
          </button>
        )}
      </header>

      <div className="relative my-5 flex h-48 items-center justify-center">
        <motion.svg
          width="180"
          height="180"
          viewBox="0 0 180 180"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="-rotate-90"
          role="img"
          aria-label={`Total de despesas: ${formatarBRL(total)}`}
        >
          <circle
            cx="90"
            cy="90"
            r="76"
            pathLength="100"
            fill="transparent"
            stroke="var(--surface-2)"
            strokeWidth="18"
          />
          {segmentos.map((item, index) => (
            <motion.circle
              key={item.category}
              cx="90"
              cy="90"
              r="76"
              pathLength="100"
              fill="transparent"
              stroke={item.color}
              strokeWidth="18"
              strokeDashoffset={-item.offset}
              initial={{ strokeDasharray: "0 100" }}
              animate={{ strokeDasharray: `${item.percentage} ${100 - item.percentage}` }}
              transition={{ duration: 0.75, delay: index * 0.08, ease: "easeInOut" }}
            />
          ))}
        </motion.svg>

        <div className="pointer-events-none absolute flex flex-col items-center">
          <span className="text-xs font-medium text-[var(--ink-faint)]">Total gasto</span>
          <strong className="mt-1 text-2xl font-extrabold tracking-tight text-[var(--ink)]">
            {formatarBRL(total)}
          </strong>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {(data.length ? data : [{ category: "Sem despesas", amount: 0, color: "var(--line)" }]).map((item) => (
          <motion.div
            key={item.category}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex min-h-20 flex-col justify-end rounded-2xl bg-[var(--surface-2)] p-3.5"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.color }} />
              <span className="truncate text-xs font-semibold text-[var(--ink-soft)]">{item.category}</span>
            </div>
            <strong className="mt-1 text-base font-extrabold text-[var(--ink)]">{formatarBRL(item.amount)}</strong>
          </motion.div>
        ))}
      </div>
    </article>
  );
}
