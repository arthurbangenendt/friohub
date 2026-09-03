import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Cabecalho, wrap } from "../../shared";
import { comoPapel } from "../../navegacao";
import { EmptyState, StatusPill } from "@/components/ui";
import { STATUS_LOTE_IMPORTACAO } from "@/lib/status";
import { ImportarPlanilha } from "./ImportarPlanilha";

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function ImportacoesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (comoPapel(profile?.role) !== "distribuidora") redirect("/painel");

  const { data } = await supabase
    .from("product_import_batches")
    .select("id, status, total_items, valid_items, error_items, criado_em")
    .order("criado_em", { ascending: false })
    .limit(50);

  const lotes = data ?? [];

  return (
    <div style={wrap}>
      <Cabecalho eyebrow="Importações" titulo="Cadastro em massa" />
      <p style={{ color: "var(--ink-soft)", fontSize: 14.5, margin: "10px 0 24px" }}>
        Cada sincronização do seu ERP (Integrações) ou planilha enviada aqui vira um lote. Revise os itens antes de
        aplicar — nada entra no catálogo sem sua confirmação.
      </p>

      <div style={{ marginBottom: 28 }}>
        <ImportarPlanilha />
      </div>

      {lotes.length === 0 ? (
        <EmptyState
          titulo="Nenhum lote de importação ainda"
          descricao="Suba uma planilha acima, ou conecte seu ERP em Integrações para sincronizar o catálogo automaticamente."
          acao={{ label: "Ir para Integrações", href: "/painel/distribuidora/integracoes" }}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {lotes.map((l) => (
            <Link
              key={l.id}
              href={`/painel/distribuidora/importacoes/${l.id}`}
              className="card"
              style={{ padding: 16, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", textDecoration: "none", color: "inherit" }}
            >
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{dataHora(l.criado_em)}</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 3 }}>
                  {l.total_items} {l.total_items === 1 ? "item" : "itens"}
                  {l.status === "ready_for_review" &&
                    ` · ${l.valid_items} válido${l.valid_items === 1 ? "" : "s"}, ${l.error_items} com erro`}
                </div>
              </div>
              <StatusPill mapa={STATUS_LOTE_IMPORTACAO} valor={l.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
