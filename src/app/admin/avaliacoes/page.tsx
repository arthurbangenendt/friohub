import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui";
import { TAG_LABEL } from "@/app/servico/[id]/tags-cliente";
import { one } from "@/lib/relacional";
import { AvaliacaoActions } from "./AvaliacaoActions";

/* Moderação de avaliação — a matriz de permissões prometia "moderar auditado"
 * pras duas reputações (profissional e cliente) e nenhuma das duas tinha
 * coluna de visibilidade, policy de admin ou RPC. Ver
 * 20260825096000_moderar_review.sql. Sem paginação de propósito, mesmo padrão
 * de admin/disputas: uma janela recente (60 de cada tabela) é o que importa
 * pra moderação — histórico completo não é o caso de uso daqui.
 */

const mono = "var(--font-geist-mono), ui-monospace, monospace";
const LIMITE = 60;

const SPEC_LABEL: Record<string, string> = {
  instalacao: "Instalação", manutencao: "Manutenção", remanejamento: "Remanejamento", limpeza: "Limpeza", conserto: "Conserto",
};

type Linha = {
  id: string;
  tipo: "profissional" | "cliente";
  clienteNome: string;
  profissionalNome: string;
  rating: number;
  created_at: string;
  oculta_em: string | null;
  oculta_motivo: string | null;
  detalhe: string;
};

export default async function AdminAvaliacoesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (perfil?.role !== "admin") redirect("/painel");

  const [{ data: reviewsPro }, { data: reviewsCliente }] = await Promise.all([
    supabase
      .from("reviews")
      .select(`id, rating, comment, specialty, created_at, oculta_em, oculta_motivo,
               cliente:profiles!reviews_cliente_id_fkey ( nome ),
               profissional:professionals ( profiles ( nome ) )`)
      .order("created_at", { ascending: false })
      .limit(LIMITE),
    supabase
      .from("client_reviews")
      .select(`id, rating, tags, created_at, oculta_em, oculta_motivo,
               cliente:profiles!client_reviews_cliente_id_fkey ( nome ),
               profissional:professionals ( profiles ( nome ) )`)
      .order("created_at", { ascending: false })
      .limit(LIMITE),
  ]);

  type ReviewProBruto = {
    id: string; rating: number; comment: string | null; specialty: string; created_at: string;
    oculta_em: string | null; oculta_motivo: string | null;
    cliente: unknown; profissional: unknown;
  };
  type ReviewClienteBruto = {
    id: string; rating: number; tags: string[]; created_at: string;
    oculta_em: string | null; oculta_motivo: string | null;
    cliente: unknown; profissional: unknown;
  };

  const nomeDe = (v: unknown) => (one(v) as { nome: string } | null)?.nome ?? "—";
  const nomeProfissional = (v: unknown) => nomeDe((one(v) as { profiles: unknown } | null)?.profiles);

  const linhasPro: Linha[] = ((reviewsPro ?? []) as unknown as ReviewProBruto[]).map((r) => ({
    id: r.id, tipo: "profissional", rating: r.rating, created_at: r.created_at,
    oculta_em: r.oculta_em, oculta_motivo: r.oculta_motivo,
    clienteNome: nomeDe(r.cliente), profissionalNome: nomeProfissional(r.profissional),
    detalhe: [SPEC_LABEL[r.specialty] ?? r.specialty, r.comment].filter(Boolean).join(" · "),
  }));

  const linhasCliente: Linha[] = ((reviewsCliente ?? []) as unknown as ReviewClienteBruto[]).map((r) => ({
    id: r.id, tipo: "cliente", rating: r.rating, created_at: r.created_at,
    oculta_em: r.oculta_em, oculta_motivo: r.oculta_motivo,
    clienteNome: nomeDe(r.cliente), profissionalNome: nomeProfissional(r.profissional),
    detalhe: (r.tags ?? []).map((t) => TAG_LABEL[t] ?? t).join(" · ") || "sem tags",
  }));

  const linhas = [...linhasPro, ...linhasCliente].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <h1 style={{ fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-0.025em", margin: "0 0 6px" }}>Avaliações</h1>
      <p style={{ color: "var(--ink-soft)", margin: "0 0 24px" }}>
        Avaliações de profissional (públicas) e de cliente (visíveis só a quem atendeu). Ocultar preserva o
        registro — a nota some da leitura de todo mundo, exceto admin, mas nunca é apagada.
      </p>

      {linhas.length === 0 ? (
        <EmptyState titulo="Nenhuma avaliação ainda" />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {linhas.map((l) => (
            <div key={`${l.tipo}-${l.id}`} className="card" style={{ padding: 16, display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 14.5 }}>{"★".repeat(l.rating)}{"☆".repeat(5 - l.rating)}</strong>
                  <span style={{ fontSize: 11.5, fontFamily: mono, padding: "3px 9px", borderRadius: 100, background: "var(--surface-2)", color: "var(--ink-soft)" }}>
                    {l.tipo === "profissional" ? "Avaliação de profissional" : "Avaliação de cliente"}
                  </span>
                  {l.oculta_em && (
                    <span style={{ fontSize: 11.5, fontFamily: mono, padding: "3px 9px", borderRadius: 100, background: "var(--danger-wash)", color: "var(--danger)" }}>
                      Oculta
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 4 }}>
                  {l.tipo === "profissional"
                    ? `${l.clienteNome} avaliou ${l.profissionalNome}`
                    : `${l.profissionalNome} avaliou ${l.clienteNome}`}
                  {" · "}{new Date(l.created_at).toLocaleDateString("pt-BR")}
                </div>
                {l.detalhe && <p style={{ fontSize: 13.5, color: "var(--ink)", margin: "8px 0 0" }}>{l.detalhe}</p>}
                {l.oculta_em && l.oculta_motivo && (
                  <p style={{ fontSize: 12.5, color: "var(--ink-faint)", margin: "6px 0 0" }}>Motivo da ocultação: {l.oculta_motivo}</p>
                )}
              </div>
              <AvaliacaoActions id={l.id} oculta={!!l.oculta_em} tipo={l.tipo} />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
