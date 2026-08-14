import Link from "next/link";
import type { ReactNode } from "react";

/* Estado vazio.
 *
 * Os textos vazios do FrioHub já eram bons — explicam o que vai aparecer ali e
 * por quê. Faltavam duas coisas: o padding variava entre 20, 26 e 28 conforme a
 * tela, e nenhum deles oferecia a ação seguinte. Tela vazia é justamente onde a
 * pessoa mais precisa de um empurrão para o próximo passo.
 *
 * `acao` é opcional de propósito: em telas onde não há nada que o usuário possa
 * fazer (o profissional não cria o próprio pedido de orçamento), um botão seria
 * mentira. */
export function EmptyState({
  titulo, descricao, acao, icone,
}: {
  titulo: string;
  descricao?: string;
  acao?: { label: string; href: string };
  icone?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
        padding: "34px 24px", borderRadius: 14,
        background: "var(--surface)", border: "1px dashed var(--line)",
        textAlign: "center",
      }}
    >
      {icone && <span style={{ color: "var(--ink-faint)", display: "flex", marginBottom: 2 }}>{icone}</span>}
      <strong style={{ fontSize: 15, color: "var(--ink)" }}>{titulo}</strong>
      {descricao && (
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-soft)", maxWidth: 420, lineHeight: 1.55 }}>
          {descricao}
        </p>
      )}
      {acao && (
        <Link href={acao.href} className="btn btn-primary" style={{ marginTop: 10, height: 40, padding: "0 18px", fontSize: 14 }}>
          {acao.label}
        </Link>
      )}
    </div>
  );
}
