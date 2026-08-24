"use client";

import { useFormStatus } from "react-dom";
import { primaryBtn } from "./ui";

/* `useFormStatus` só enxerga o estado do <form> pai quando o componente que
 * o chama é filho dele — por isso isto precisa ser um componente à parte
 * (client), não dá pra ler `pending` direto na page.tsx (Server Component).
 * Sem isso, o clique em "Entrar" não dava nenhum sinal visual durante o
 * round-trip do server action — parecia que não tinha acontecido nada. */
export function BotaoEntrar({ label = "Entrar", labelEnviando = "Entrando..." }: { label?: string; labelEnviando?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending}
      style={{ ...primaryBtn, opacity: pending ? 0.7 : 1, cursor: pending ? "not-allowed" : "pointer" }}>
      {pending ? labelEnviando : label}
    </button>
  );
}
