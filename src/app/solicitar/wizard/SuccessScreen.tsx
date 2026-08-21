import Link from "next/link";
import { Check as CheckIcon } from "@/components/icons";
import { Shell } from "./shared-components";
import { btnPrimary } from "./styles";
import type { GeoState } from "./types";

export function SuccessScreen({ geo, sucessoId, enviados }: { geo: GeoState; sucessoId: string; enviados: number }) {
  return (
    <Shell geo={geo}>
      <div style={{ textAlign: "center", padding: "40px 0" }}>
        <div style={{ display: "inline-grid", placeItems: "center", width: 64, height: 64, borderRadius: "50%", background: "var(--cool-wash)", color: "var(--cool-deep)" }}><CheckIcon size={32} /></div>
        <h1 style={{ fontSize: "1.8rem", fontWeight: 800, letterSpacing: "-0.02em", margin: "16px 0 8px" }}>Pedido enviado!</h1>
        <p style={{ color: "var(--ink-soft)", maxWidth: 440, margin: "0 auto 8px" }}>
          {enviados === 1
            ? "Um profissional recebeu seu pedido"
            : `${enviados} profissionais receberam seu pedido`}{" "}
          e vão responder com propostas. Você compara preço, prazo e garantia antes de escolher —
          sem compromisso.
        </p>
        <p style={{ color: "var(--ink-faint)", fontSize: 13.5, maxWidth: 440, margin: "0 auto 24px" }}>
          Enquanto isso, dá para conversar com eles pelo chat para tirar dúvidas.
        </p>
        <Link href={`/painel/orcamentos/${sucessoId}`} style={btnPrimary}>Ver meu pedido</Link>
      </div>
    </Shell>
  );
}
