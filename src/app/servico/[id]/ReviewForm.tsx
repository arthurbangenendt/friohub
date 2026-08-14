"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { avaliarJob } from "./actions";
import { Star } from "@/components/icons";

export function ReviewForm({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  if (sucesso) {
    return (
      <div role="status" style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid var(--good)", background: "var(--cool-wash)", color: "var(--good)", fontSize: 14, fontWeight: 650 }}>
        ✓ {sucesso}
      </div>
    );
  }

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
        maxLength={2000}
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
            if (!r.ok) {
              setErro(r.error ?? "Não foi possível enviar a avaliação.");
              return;
            }
            setSucesso(r.alreadyExisted ? "Sua avaliação já estava registrada." : "Avaliação enviada com sucesso.");
            router.refresh();
          })
        }
      >
        {pending ? "Enviando..." : "Enviar avaliação"}
      </button>
      {erro && <p style={{ color: "var(--danger)", fontSize: 13.5, marginTop: 8 }}>{erro}</p>}
    </div>
  );
}
