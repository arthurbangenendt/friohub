"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { avaliarCliente } from "./actions";
import { TAGS_CLIENTE } from "./tags-cliente";
import { Star } from "@/components/icons";

/* Avaliação do cliente pelo profissional. Sem campo de texto livre de propósito:
   a nota e as tags fechadas dão a informação operacional sem virar registro
   ofensivo sobre uma pessoa. Visível apenas para outros profissionais. */
export function AvaliarCliente({ jobId, clienteNome }: { jobId: string; clienteNome: string }) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);

  function toggle(id: string) {
    setTags((cur) => {
      const p = new Set(cur);
      if (p.has(id)) p.delete(id); else p.add(id);
      return p;
    });
  }

  function enviar() {
    setErro(null);
    start(async () => {
      const r = await avaliarCliente({ jobId, rating, tags: [...tags] });
      if (!r.ok) { setErro(r.error); return; }
      setPronto(true);
      router.refresh();
    });
  }

  if (pronto) {
    return (
      <p style={{ margin: 0, fontSize: 14, color: "var(--good)", fontWeight: 600 }}>
        Avaliação registrada. Obrigado — isso ajuda os próximos profissionais.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.6 }}>
        Como foi atender <strong>{clienteNome}</strong>? Sua avaliação é vista apenas por
        outros profissionais — o cliente não tem acesso a ela.
      </p>

      <div style={{ display: "flex", gap: 4 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} estrela${n > 1 ? "s" : ""}`}
            style={{ border: "none", background: "none", cursor: "pointer", padding: 2, color: rating >= n ? "var(--warm)" : "var(--ink-faint)", display: "flex" }}>
            <Star size={26} filled={rating >= n} />
          </button>
        ))}
      </div>

      <div>
        <span style={{ fontSize: 12.5, fontWeight: 650, color: "var(--ink-soft)" }}>O que aconteceu (opcional)</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {TAGS_CLIENTE.map((t) => {
            const on = tags.has(t.id);
            return (
              <button key={t.id} type="button" onClick={() => toggle(t.id)}
                style={{
                  padding: "7px 13px", borderRadius: 100, fontSize: 13, cursor: "pointer",
                  fontWeight: on ? 650 : 500,
                  border: `1px solid ${on ? (t.bom ? "var(--good)" : "var(--warm)") : "var(--line)"}`,
                  background: on ? (t.bom ? "var(--good-wash)" : "var(--warm-wash)") : "var(--surface)",
                  color: on ? (t.bom ? "#1f7a5c" : "var(--warm)") : "var(--ink-soft)",
                }}>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {erro && <p style={{ color: "var(--danger)", fontSize: 13.5, margin: 0 }}>{erro}</p>}

      <button onClick={enviar} disabled={rating === 0 || pending} className="btn btn-primary"
        style={{ alignSelf: "flex-start", opacity: rating === 0 ? 0.55 : 1 }}>
        {pending ? "Enviando..." : "Enviar avaliação"}
      </button>
    </div>
  );
}
