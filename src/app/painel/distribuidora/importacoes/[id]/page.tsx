import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Cabecalho, wrap } from "../../../shared";
import { comoPapel } from "../../../navegacao";
import { ImportacaoPreview, type ItemLinha } from "./ImportacaoPreview";
import { StatusPill } from "@/components/ui";
import { STATUS_LOTE_IMPORTACAO } from "@/lib/status";

export default async function ImportacaoDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (comoPapel(profile?.role) !== "distribuidora") redirect("/painel");

  /* Sem linha de volta aqui já significa "não é seu lote" — a RLS
     (import_batches_dist_read, 20260903120000) filtra por dono antes mesmo
     de chegar no notFound(). */
  const { data: lote } = await supabase
    .from("product_import_batches")
    .select("id, status, total_items, valid_items, error_items, criado_em, validado_em")
    .eq("id", id)
    .maybeSingle();

  if (!lote) notFound();

  const { data: itens } = await supabase
    .from("product_import_items")
    .select("id, line_number, sku_distribuidor, raw, action, status, errors, image_status, image_final_url")
    .eq("batch_id", id)
    .order("line_number");

  return (
    <div style={wrap}>
      <Cabecalho eyebrow="Importações" titulo="Detalhe do lote" />
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0 24px" }}>
        <StatusPill mapa={STATUS_LOTE_IMPORTACAO} valor={lote.status} />
        <span style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>
          {lote.total_items} itens · {lote.valid_items} válidos · {lote.error_items} com erro
        </span>
      </div>
      <ImportacaoPreview batchId={lote.id} status={lote.status} itens={(itens ?? []) as ItemLinha[]} />
    </div>
  );
}
