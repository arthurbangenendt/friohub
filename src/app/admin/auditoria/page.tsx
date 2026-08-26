import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui";

/* Visualizador de `admin_audit_log` — a tabela já é gravada em toda decisão
 * administrativa (verificação, disputa, feature flag) desde 20260813160000,
 * mas não existia tela nenhuma pra lê-la: "quem aprovou esse profissional e
 * por quê" só se respondia com SQL direto no banco. Só leitura — a tabela
 * já revoga insert/update/delete de authenticated (só RPC audita escrita).
 */

const mono = "var(--font-geist-mono), ui-monospace, monospace";
const POR_PAGINA = 50;

const ACAO_LABEL: Record<string, string> = {
  verification_changed: "Verificação alterada",
  feature_flag_changed: "Feature flag alterada",
  rejeitar_disputa: "Disputa rejeitada",
  aprovar_disputa: "Disputa aprovada",
  role_changed: "Papel alterado",
  user_suspended: "Login suspenso",
  user_reactivated: "Login reativado",
  review_moderated: "Avaliação moderada",
};

const ENTIDADE_LABEL: Record<string, string> = {
  professional: "Profissional",
  distributor: "Distribuidora",
  feature_flag: "Feature flag",
  job_disputes: "Disputa",
  profile: "Usuário",
  reviews: "Avaliação de profissional",
  client_reviews: "Avaliação de cliente",
};

function linkEntidade(entityType: string, entityId: string): string | null {
  if (entityType === "professional") return `/profissional/${entityId}`;
  if (entityType === "job_disputes") return "/admin/disputas";
  return null;
}

type Registro = {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  reason: string;
  created_at: string;
};

/* Só as chaves que mudaram (ou que só existem de um lado) — old/new_values
   são jsonb livre por natureza da tabela, então o diff é genérico. */
function diff(old: Record<string, unknown>, novo: Record<string, unknown>): string[] {
  const chaves = [...new Set([...Object.keys(old), ...Object.keys(novo)])];
  return chaves
    .filter((k) => JSON.stringify(old[k]) !== JSON.stringify(novo[k]))
    .map((k) => `${k}: ${old[k] === undefined ? "—" : JSON.stringify(old[k])} → ${novo[k] === undefined ? "—" : JSON.stringify(novo[k])}`);
}

const campo: React.CSSProperties = {
  height: 38, border: "1px solid var(--line)", borderRadius: 9, padding: "0 10px",
  background: "var(--surface)", color: "var(--ink)", font: "inherit", fontSize: 13.5,
};

export default async function AdminAuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ pagina?: string; tipo?: string; acao?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (perfil?.role !== "admin") redirect("/painel");

  const sp = await searchParams;
  const paginaSolicitada = Number.parseInt(sp.pagina ?? "1", 10);
  const pagina = Number.isFinite(paginaSolicitada) && paginaSolicitada > 0 ? paginaSolicitada : 1;
  const inicio = (pagina - 1) * POR_PAGINA;

  let consulta = supabase
    .from("admin_audit_log")
    .select("id, actor_id, action, entity_type, entity_id, old_values, new_values, reason, created_at", { count: "exact" });
  if (sp.tipo) consulta = consulta.eq("entity_type", sp.tipo);
  if (sp.acao) consulta = consulta.eq("action", sp.acao);
  consulta = consulta.order("created_at", { ascending: false }).range(inicio, inicio + POR_PAGINA - 1);

  const { data, count } = await consulta;
  const registros = (data ?? []) as Registro[];

  // Nomes em lote — nada de consulta por linha (mesmo padrão de admin/assinaturas).
  const atorIds = [...new Set(registros.map((r) => r.actor_id).filter((id): id is string => !!id))];
  const { data: perfis } = atorIds.length
    ? await supabase.from("profiles").select("id, nome").in("id", atorIds)
    : { data: [] };
  const nomePorId = new Map((perfis ?? []).map((p) => [p.id, p.nome]));

  const total = count ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <h1 style={{ fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-0.025em", margin: "0 0 6px" }}>Auditoria</h1>
      <p style={{ color: "var(--ink-soft)", margin: "0 0 22px" }}>
        Toda decisão administrativa auditada — verificações, disputas, feature flags. {total} registro{total === 1 ? "" : "s"}.
      </p>

      <form method="get" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24, alignItems: "center" }}>
        <select name="tipo" defaultValue={sp.tipo ?? ""} style={campo}>
          <option value="">Todas as entidades</option>
          {Object.entries(ENTIDADE_LABEL).map(([valor, label]) => (
            <option key={valor} value={valor}>{label}</option>
          ))}
        </select>
        <select name="acao" defaultValue={sp.acao ?? ""} style={campo}>
          <option value="">Todas as ações</option>
          {Object.entries(ACAO_LABEL).map(([valor, label]) => (
            <option key={valor} value={valor}>{label}</option>
          ))}
        </select>
        <button type="submit" className="btn" style={{ height: 38 }}>Filtrar</button>
        {(sp.tipo || sp.acao) && <Link href="/admin/auditoria" style={{ fontSize: 13, color: "var(--ink-faint)" }}>Limpar</Link>}
      </form>

      {registros.length === 0 ? (
        <EmptyState titulo="Nenhum registro" descricao="Nenhuma decisão administrativa bate com esse filtro." />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {registros.map((r) => {
            const alteracoes = diff(r.old_values ?? {}, r.new_values ?? {});
            const href = linkEntidade(r.entity_type, r.entity_id);
            return (
              <div key={r.id} className="card" style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <strong style={{ fontSize: 14.5 }}>{ACAO_LABEL[r.action] ?? r.action}</strong>
                      <span style={{ fontSize: 11.5, fontFamily: mono, padding: "3px 9px", borderRadius: 100, background: "var(--surface-2)", color: "var(--ink-soft)" }}>
                        {ENTIDADE_LABEL[r.entity_type] ?? r.entity_type}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 3 }}>
                      {r.actor_id ? (nomePorId.get(r.actor_id) ?? "Admin") : "Sistema (migration)"} ·{" "}
                      {new Date(r.created_at).toLocaleString("pt-BR")}
                    </div>
                  </div>
                  {href ? (
                    <Link href={href} style={{ fontSize: 13, color: "var(--cool)", whiteSpace: "nowrap" }}>Ver →</Link>
                  ) : (
                    <span style={{ fontFamily: mono, fontSize: 11.5, color: "var(--ink-faint)" }}>{r.entity_id.slice(0, 8)}</span>
                  )}
                </div>
                {r.reason && <p style={{ fontSize: 13.5, color: "var(--ink)", margin: "10px 0 0" }}>{r.reason}</p>}
                {alteracoes.length > 0 && (
                  <div style={{ marginTop: 8, display: "grid", gap: 3 }}>
                    {alteracoes.map((linha) => (
                      <span key={linha} style={{ fontFamily: mono, fontSize: 12, color: "var(--ink-faint)" }}>{linha}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {totalPaginas > 1 && (
        <nav style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 22, fontSize: 13.5 }}>
          {pagina > 1
            ? <Link href={`/admin/auditoria?pagina=${pagina - 1}${sp.tipo ? `&tipo=${sp.tipo}` : ""}${sp.acao ? `&acao=${sp.acao}` : ""}`}>← Anterior</Link>
            : <span />}
          <span style={{ color: "var(--ink-faint)" }}>Página {pagina} de {totalPaginas}</span>
          {inicio + registros.length < total
            ? <Link href={`/admin/auditoria?pagina=${pagina + 1}${sp.tipo ? `&tipo=${sp.tipo}` : ""}${sp.acao ? `&acao=${sp.acao}` : ""}`}>Próxima →</Link>
            : <span />}
        </nav>
      )}
    </main>
  );
}
