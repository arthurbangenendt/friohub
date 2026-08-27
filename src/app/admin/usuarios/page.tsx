import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROTULO_PAPEL, comoPapel } from "@/app/painel/navegacao";
import { EmptyState } from "@/components/ui";
import { UsuarioActions } from "./UsuarioActions";

/* Busca de cliente/admin — profissional e distribuidora já têm tela própria
 * (Cadastros > Profissionais/Distribuidoras), com o ciclo de vida de
 * verificação deles; aqui é só quem esta tela sabe agir de verdade: alternar
 * cliente<->admin e suspender login de cliente.
 *
 * `profiles` é lido por qualquer authenticated (policy `profiles_read_auth`)
 * e `profile_private.telefone` já é admin-readable (`profile_private_admin_read`)
 * — nenhuma policy nova precisou nascer pra essa busca em si; as duas ações
 * (papel, suspensão) é que exigiram RPC e edge function novas.
 */

const mono = "var(--font-geist-mono), ui-monospace, monospace";
const POR_PAGINA = 30;

type Linha = { id: string; nome: string; role: string; created_at: string };

export default async function AdminUsuariosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: perfilLogado } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (perfilLogado?.role !== "admin") redirect("/painel");

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  // Vírgula e parênteses quebram a sintaxe de `.or()` do PostgREST — o resto do texto de busca é livre.
  const qSeguro = q.replace(/[,()]/g, "");
  const paginaSolicitada = Number.parseInt(sp.pagina ?? "1", 10);
  const pagina = Number.isFinite(paginaSolicitada) && paginaSolicitada > 0 ? paginaSolicitada : 1;
  const inicio = (pagina - 1) * POR_PAGINA;

  // Só cliente e admin — profissional/distribuidora vivem em Cadastros.
  // Sem busca, lista todo mundo (mais recente primeiro) — busca só estreita.
  let consulta = supabase.from("profiles").select("id, nome, role, created_at", { count: "exact" }).in("role", ["cliente", "admin"]);
  if (qSeguro) {
    const { data: porTelefone } = await supabase
      .from("profile_private")
      .select("id")
      .ilike("telefone", `%${qSeguro}%`);
    const idsTelefone = (porTelefone ?? []).map((p) => p.id);

    const filtro = idsTelefone.length
      ? `nome.ilike.%${qSeguro}%,id.in.(${idsTelefone.join(",")})`
      : `nome.ilike.%${qSeguro}%`;
    consulta = consulta.or(filtro);
  }

  const { data, count } = await consulta
    .order(qSeguro ? "nome" : "created_at", { ascending: !!qSeguro })
    .range(inicio, inicio + POR_PAGINA - 1);

  const registros = (data ?? []) as Linha[];
  const total = count ?? 0;

  const clienteIds = registros.filter((r) => r.role === "cliente").map((r) => r.id);
  const { data: eventosSuspensao } = clienteIds.length
    ? await supabase
      .from("admin_audit_log")
      .select("entity_id, action, created_at")
      .eq("entity_type", "profile")
      .in("action", ["user_suspended", "user_reactivated"])
      .in("entity_id", clienteIds)
      .order("created_at", { ascending: false })
    : { data: [] };

  // Primeira ocorrência de cada pessoa já é a mais recente (ordem desc).
  const suspensoPorId = new Map<string, boolean>();
  for (const e of (eventosSuspensao ?? []) as { entity_id: string; action: string }[]) {
    if (!suspensoPorId.has(e.entity_id)) suspensoPorId.set(e.entity_id, e.action === "user_suspended");
  }

  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const qs = qSeguro ? `&q=${encodeURIComponent(qSeguro)}` : "";

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <h1 style={{ fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-0.025em", margin: "0 0 6px" }}>Usuários</h1>
      <p style={{ color: "var(--ink-soft)", margin: "0 0 22px" }}>
        Clientes e admins, mais recentes primeiro — profissional e distribuidora ficam em Cadastros. Busque
        por nome ou telefone pra estreitar, promova/revogue admin ou suspenda o login de um cliente.
      </p>

      <form method="get" style={{ display: "flex", gap: 10, marginBottom: 24 }}>
        <input
          name="q"
          defaultValue={qSeguro}
          placeholder="Nome ou telefone"
          aria-label="Buscar por nome ou telefone"
          style={{ flex: 1, maxWidth: 340, height: 40, border: "1px solid var(--line)", borderRadius: 9, padding: "0 12px", background: "var(--surface)", color: "var(--ink)", font: "inherit" }}
        />
        <button type="submit" className="btn btn-primary" style={{ height: 40 }}>Buscar</button>
      </form>

      {registros.length === 0 ? (
        qSeguro
          ? <EmptyState titulo="Ninguém encontrado" descricao={`Nenhum usuário com nome ou telefone parecido com "${qSeguro}".`} />
          : <EmptyState titulo="Nenhum usuário cadastrado ainda" />
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {registros.map((r) => {
            const papel = comoPapel(r.role);
            const suspenso = suspensoPorId.get(r.id) ?? false;
            return (
              <div key={r.id} className="card" style={{ padding: 18, display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 15.5 }}>{r.nome}</strong>
                    <span style={{ fontSize: 11.5, fontFamily: mono, color: "var(--ink-faint)" }}>{ROTULO_PAPEL[papel]}</span>
                    {suspenso && (
                      <span style={{ fontSize: 11.5, fontFamily: mono, padding: "3px 9px", borderRadius: 100, background: "var(--danger-wash)", color: "var(--danger)" }}>
                        Login suspenso
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 4 }}>
                    Desde {new Date(r.created_at).toLocaleDateString("pt-BR")}
                  </div>
                </div>
                <UsuarioActions userId={r.id} role={r.role} suspenso={suspenso} souEu={r.id === user.id} />
              </div>
            );
          })}
        </div>
      )}

      {totalPaginas > 1 && (
        <nav style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 22, fontSize: 13.5 }}>
          {pagina > 1
            ? <Link href={`/admin/usuarios?pagina=${pagina - 1}${qs}`}>← Anterior</Link>
            : <span />}
          <span style={{ color: "var(--ink-faint)" }}>Página {pagina} de {totalPaginas}</span>
          {inicio + registros.length < total
            ? <Link href={`/admin/usuarios?pagina=${pagina + 1}${qs}`}>Próxima →</Link>
            : <span />}
        </nav>
      )}
    </main>
  );
}
