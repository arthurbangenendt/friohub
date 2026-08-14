import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "../(auth)/actions";
import { Logo } from "@/components/icons";
import { PainelNav } from "./PainelNav";
import { Avatar } from "./Avatar";
import { comoPapel, HREF_PERFIL, NAV_POR_PAPEL, ROTULO_PAPEL } from "./navegacao";
import { featureHabilitada } from "@/lib/feature-flags";

/* Shell da área logada. Cada papel vê uma navegação diferente — a distinção sai
   de `profiles.role`, não de heurística na tela. O mapa papel → itens vive em
   `navegacao.ts`; ver lá a regra sobre não listar rota inexistente. */
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
  const papel = comoPapel(profile?.role);
  const itensDoPapel = NAV_POR_PAPEL[papel];
  const flags = [...new Set(itensDoPapel.flatMap((item) => item.feature ? [item.feature] : []))];
  const resultados = await Promise.all(flags.map(async (flag) => [flag, await featureHabilitada(supabase, flag, user.id)] as const));
  const habilitadas = new Map(resultados);
  const itens = itensDoPapel.filter((item) => !item.feature || habilitadas.get(item.feature));
  const hrefPerfil = HREF_PERFIL[papel];

  /* Contagem de não lidas para a bolinha do menu. `head: true` traz só o total,
     sem as linhas — o layout roda em toda navegação do painel. A RLS de
     `messages` já limita às conversas de quem está logado. */
  const { count: naoLidas } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .is("read_at", null)
    .neq("sender_id", user.id);

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
              {ROTULO_PAPEL[papel]}
            </span>
          </span>
        </Link>

        <PainelNav itens={itens} naoLidas={naoLidas ?? 0} />

        <form action={logout} className="painel-sair-wrap">
          <button type="submit" className="painel-sair">Sair</button>
        </form>
      </aside>

      <main className="painel-main">{children}</main>
    </div>
  );
}
