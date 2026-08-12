"use client";

import { useState, useTransition } from "react";
import { avaliarJob } from "./actions";
import { Star } from "@/components/icons";

export function ReviewForm({ jobId }: { jobId: string }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {[1, 2, 3, 4, 5].map((n) => {
          const on = (hover || rating) >= n;
          return (
            <button
              key={n}
              type="button"
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => setRating(n)}
              aria-label={`${n} estrela${n > 1 ? "s" : ""}`}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: on ? "var(--warm)" : "var(--ink-faint)", display: "flex" }}
            >
              <Star size={30} filled={on} />
            </button>
          );
        })}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Conte como foi o serviço (opcional)"
        rows={3}
        style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: 15, resize: "vertical", marginBottom: 14 }}
      />
      <button
        className="btn btn-primary"
        disabled={pending || rating === 0}
        style={{ opacity: rating === 0 ? 0.5 : 1 }}
        onClick={() =>
          start(async () => {
            setErro(null);
            const r = await avaliarJob({ jobId, rating, comment });
            if (!r.ok) setErro(r.error ?? "Erro.");
          })
        }
      >
        {pending ? "Enviando..." : "Enviar avaliação"}
      </button>
      {erro && <p style={{ color: "#b3261e", fontSize: 13.5, marginTop: 8 }}>{erro}</p>}
    </div>
  );
}
