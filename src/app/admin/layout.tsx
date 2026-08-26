import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "../(auth)/actions";
import { Logo } from "@/components/icons";
import { Avatar } from "../painel/Avatar";
import { AdminNav } from "./AdminNav";
import { GRUPOS_ADMIN, type BadgesAdmin } from "./navegacao";

/* Shell do admin — mesmas classes CSS do shell de /painel (painel-shell/
 * painel-side/painel-main), que já é responsivo de verdade (sidebar no
 * desktop, barra horizontal abaixo de 880px — globals.css:441). Antes o
 * admin não tinha layout nenhum: cada página era uma ilha sem navegação,
 * o que também é a causa de "parecer mobile" numa tela larga — não sobrava
 * shell nenhum ao redor do conteúdo centralizado e estreito.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: perfil } = await supabase.from("profiles").select("nome, role, avatar_url").eq("id", user.id).single();
  if (perfil?.role !== "admin") redirect("/painel");

  const [
    { count: profissionaisPendentes },
    { count: distribuidorasPendentes },
    { count: leadsPendentes },
    { count: disputasAbertas },
  ] = await Promise.all([
    supabase.from("professionals").select("id", { count: "exact", head: true }).in("verification_status", ["pendente", "em_analise"]),
    supabase.from("distributors").select("id", { count: "exact", head: true }).in("verification_status", ["pendente", "em_analise"]),
    supabase.from("distributor_interest").select("id", { count: "exact", head: true }).is("contatado_em", null),
    supabase.from("job_disputes").select("id", { count: "exact", head: true }).in("status", ["aberta", "processando_reembolso"]),
  ]);

  const badges: BadgesAdmin = {
    profissionais: profissionaisPendentes ?? 0,
    distribuidoras: distribuidorasPendentes ?? 0,
    leads: leadsPendentes ?? 0,
    disputas: disputasAbertas ?? 0,
  };

  return (
    <div className="painel-shell">
      <aside className="painel-side">
        <Link href="/" className="painel-brand">
          <span style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 8, background: "var(--cool)", color: "#fff" }}>
            <Logo size={16} />
          </span>
          FrioHub
        </Link>

        <Link href="/painel/perfil-cliente" className="painel-user">
          <Avatar nome={perfil?.nome ?? "Admin"} id={user.id} url={perfil?.avatar_url} size={38} />
          <span style={{ minWidth: 0 }} data-nome>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {perfil?.nome ?? "Admin"}
            </span>
            <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-faint)" }}>Administrador</span>
          </span>
        </Link>

        <AdminNav grupos={GRUPOS_ADMIN} badges={badges} />

        <form action={logout} className="painel-sair-wrap">
          <button type="submit" className="painel-sair">Sair</button>
        </form>
      </aside>

      <main className="painel-main" id="conteudo">{children}</main>
    </div>
  );
}
