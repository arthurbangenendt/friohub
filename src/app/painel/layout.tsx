import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "../(auth)/actions";
import { Logo } from "@/components/icons";
import { PainelNav, type ItemNav } from "./PainelNav";
import { Avatar } from "./Avatar";

/* Shell da área logada. Cliente e parceiro veem navegações diferentes — a
   distinção sai de `profiles.role`, não de heurística na tela.

   Só entram aqui itens cuja rota já existe: link morto na navegação principal
   é pior do que funcionalidade ausente. */
export default async function PainelLayout({ children }: LayoutProps<"/painel">) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("nome, role, avatar_url")
    .eq("id", user.id)
    .single();

  const nome = profile?.nome ?? user.email ?? "Você";
  const role = profile?.role ?? "cliente";
  const isPro = role === "profissional";

  const itens: ItemNav[] = isPro
    ? [
        { href: "/painel", label: "Visão geral", icone: "visao" },
        { href: "/painel/financeiro", label: "Financeiro", icone: "financeiro" },
        { href: "/painel/avaliacoes", label: "Avaliações", icone: "avaliacoes" },
        { href: "/painel/ferramentas", label: "Ferramentas", icone: "ferramentas" },
        { href: "/painel/perfil", label: "Meu perfil", icone: "perfil" },
      ]
    : [
        { href: "/painel", label: "Meus pedidos", icone: "servicos" },
        { href: "/painel/financeiro", label: "Financeiro", icone: "financeiro" },
        { href: "/painel/perfil-cliente", label: "Meu perfil", icone: "perfil" },
      ];

  if (role === "admin") itens.push({ href: "/admin", label: "Admin", icone: "admin" });

  const hrefPerfil = isPro ? "/painel/perfil" : "/painel/perfil-cliente";

  return (
    <div className="painel-shell">
      <aside className="painel-side">
        <Link href="/" className="painel-brand">
          <span style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 8, background: "var(--cool)", color: "#fff" }}>
            <Logo size={16} />
          </span>
          FrioHub
        </Link>

        {/* Clicar no avatar leva ao perfil — é onde a pessoa troca foto e dados. */}
        <Link href={hrefPerfil} className="painel-user">
          <Avatar nome={nome} id={user.id} url={profile?.avatar_url} size={38} />
          <span style={{ minWidth: 0 }} data-nome>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nome}</span>
            <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-faint)" }}>
              {isPro ? "Parceiro" : role === "admin" ? "Administrador" : "Cliente"}
            </span>
          </span>
        </Link>

        <PainelNav itens={itens} />

        <form action={logout} className="painel-sair-wrap">
          <button type="submit" className="painel-sair">Sair</button>
        </form>
      </aside>

      <main className="painel-main">{children}</main>
    </div>
  );
}
