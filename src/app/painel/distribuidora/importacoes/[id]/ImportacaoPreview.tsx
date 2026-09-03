"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { aplicarLoteImportacao, rejeitarLoteImportacao } from "../actions";
import { Alert } from "@/components/ui";
import { CAT_LABEL } from "@/lib/produtos";
import { formatarBRL } from "@/lib/pricing";

const mono = "var(--font-geist-mono), ui-monospace, monospace";

export type ItemLinha = {
  id: string;
  line_number: number;
  sku_distribuidor: string;
  raw: Record<string, unknown>;
  action: "insert" | "update" | null;
  status: "pending" | "valid" | "error";
  errors: string[];
  image_status: "pending" | "fetched" | "failed" | "skipped";
  image_final_url: string | null;
};

const ACAO_LABEL: Record<string, string> = { insert: "Novo produto", update: "Atualiza existente" };
const IMAGEM_LABEL: Record<ItemLinha["image_status"], string> = {
  fetched: "OK", failed: "Falhou", skipped: "Sem foto", pending: "…",
};

/* Preview do lote de importação em massa.
 *
 * Só produto marcado `valid` entra em products (via aplicar_lote_importacao,
 * 20260903140000) — item com erro fica visível aqui para correção no ERP e
 * reenvio; o próximo sync com o mesmo SKU vira update, não duplica. */
export function ImportacaoPreview({
  batchId, status, itens,
}: {
  batchId: string;
  status: string;
  itens: ItemLinha[];
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ aplicados: number; ignorados: number } | null>(null);
  const [pending, startTransition] = useTransition();

  const validos = itens.filter((i) => i.status === "valid").length;
  const pendentes = itens.filter((i) => i.status === "pending").length;

  function aplicar() {
    if (!confirm(`Aplicar ${validos} produto${validos === 1 ? "" : "s"} válido${validos === 1 ? "" : "s"} ao catálogo?`)) return;
    setErro(null);
    startTransition(async () => {
      const r = await aplicarLoteImportacao(batchId);
      if (!r.ok) return setErro(r.error);
      setResultado({ aplicados: r.aplicados, ignorados: r.ignorados });
      router.refresh();
    });
  }

  function rejeitar() {
    if (!confirm("Rejeitar este lote? Nenhum produto dele entra no catálogo.")) return;
    setErro(null);
    startTransition(async () => {
      const r = await rejeitarLoteImportacao(batchId);
      if (!r.ok) return setErro(r.error);
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {erro && <Alert tipo="erro">{erro}</Alert>}
      {resultado && (
        <Alert tipo="sucesso" titulo="Lote aplicado">
          {resultado.aplicados} produto{resultado.aplicados === 1 ? "" : "s"} aplicado{resultado.aplicados === 1 ? "" : "s"} ao catálogo.
          {resultado.ignorados > 0 &&
            ` ${resultado.ignorados} item${resultado.ignorados === 1 ? "" : "ns"} ignorado${resultado.ignorados === 1 ? "" : "s"} (produto mudou de dono ou foi removido entre a validação e a aplicação).`}
        </Alert>
      )}

      {pendentes > 0 && (
        <Alert tipo="info">
          Ainda validando {pendentes} {pendentes === 1 ? "item" : "itens"}… atualize a página em instantes.
        </Alert>
      )}

      {status === "ready_for_review" && !resultado && (
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-primary" onClick={aplicar} disabled={pending || validos === 0}>
            {pending ? "Aplicando…" : `Aplicar ${validos} produto${validos === 1 ? "" : "s"} válido${validos === 1 ? "" : "s"}`}
          </button>
          <button className="btn" onClick={rejeitar} disabled={pending}
            style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
            Rejeitar lote
          </button>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--ink-faint)", fontSize: 12 }}>
              <th style={{ padding: "8px 10px" }}>#</th>
              <th style={{ padding: "8px 10px" }}>SKU</th>
              <th style={{ padding: "8px 10px" }}>Produto</th>
              <th style={{ padding: "8px 10px" }}>Custo</th>
              <th style={{ padding: "8px 10px" }}>Ação</th>
              <th style={{ padding: "8px 10px" }}>Foto</th>
              <th style={{ padding: "8px 10px" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((it) => {
              const marca = String(it.raw.marca ?? "");
              const modelo = String(it.raw.modelo ?? "");
              const categoria = String(it.raw.categoria ?? "");
              const custo = Number(it.raw.custo ?? 0);
              return (
                <tr key={it.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "8px 10px", color: "var(--ink-faint)" }}>{it.line_number}</td>
                  <td style={{ padding: "8px 10px", fontFamily: mono }}>{it.sku_distribuidor}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <div style={{ fontWeight: 600 }}>{marca} {modelo}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>{CAT_LABEL[categoria] ?? (categoria || "—")}</div>
                  </td>
                  <td style={{ padding: "8px 10px" }}>{custo > 0 ? formatarBRL(custo) : "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{it.action ? ACAO_LABEL[it.action] : "—"}</td>
                  <td style={{ padding: "8px 10px", color: it.image_status === "failed" ? "var(--warm)" : "var(--ink-faint)" }}>
                    {IMAGEM_LABEL[it.image_status]}
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    {it.status === "valid" && <span style={{ color: "var(--good)" }}>Válido</span>}
                    {it.status === "pending" && <span style={{ color: "var(--ink-faint)" }}>Validando…</span>}
                    {it.status === "error" && <span style={{ color: "var(--danger)" }}>{it.errors.join(" ")}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
