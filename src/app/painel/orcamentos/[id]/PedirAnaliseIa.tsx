import Link from "next/link";
import { Sparkle } from "@/components/icons";

/* Entrada do modo triagem do Assistente IA a partir de um pedido específico.
   Link profundo em vez de campo de colar texto: a página do assistente busca
   os dados estruturados do orçamento direto do banco (via `quoteRequestId`),
   o que é mais seguro (não depende do técnico copiar certo) e mais barato em
   tokens do que texto livre. O gate de plano/feature flag é checado lá — este
   link fica sempre visível, mesmo padrão do resto do painel. */
export function PedirAnaliseIa({ pedidoId }: { pedidoId: string }) {
  return (
    <Link
      href={`/painel/assistente?orcamento=${pedidoId}`}
      className="btn"
      style={{ gap: 8, border: "1px solid var(--line)", background: "var(--surface)", textDecoration: "none" }}
    >
      <Sparkle size={17} /> Pedir análise da IA
    </Link>
  );
}
