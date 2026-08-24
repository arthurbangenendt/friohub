import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "../(auth)/actions";
import { Logo } from "@/components/icons";
import { PainelNav } from "./PainelNav";
import { Avatar } from "./Avatar";
import { comoPapel, HREF_PERFIL, NAV_POR_PAPEL, ROTULO_PAPEL } from "./navegacao";
import { featureHabilitada } from "@/lib/feature-flags";
import { categoriaNotificacao } from "@/lib/notificacoes";
import { Bell } from "@/components/icons";

/* O rótulo carrega o número porque o badge visual é `aria-hidden`: quem usa
   leitor de tela precisa ouvir "3 notificações novas", não "Notificações" e
   depois um "3" solto. */
function rotuloSino(n: number) {
  if (n === 0) return "Notificações";
  return `Notificações, ${n} ${n === 1 ? "nova" : "novas"}`;
}

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
  /* Para o admin, a RLS libera todas as mensagens para auditoria. Contar
     `read_at is null` nesse papel mostraria como se TODAS as mensagens ainda
     não lidas do sistema fossem pendências pessoais dele. O admin acompanha o
     fluxo, mas não é destinatário; por isso o badge fica restrito aos dois
     participantes reais. */
  /* `sender_id` pode ser nulo desde 20260815092000 (equipe FrioHub respondendo
     pelo painel do Chatwoot, automação). `neq` sozinho descartaria essas linhas
     — em SQL, `null <> uuid` é NULL, não `true` —, e mensagem da equipe nunca
     apareceria no badge. O `or` restaura o sentido de "não fui eu quem mandou". */
  const { count: naoLidas } = papel === "admin"
    ? { count: 0 }
    : await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .is("read_at", null)
      .or(`sender_id.is.null,sender_id.neq.${user.id}`);

  /* Notificações não lidas, trazidas como lista de tipos em vez de contagem:
     com uma consulta só dá para alimentar o sino (total) e os contadores por
     item de menu (orçamentos, agenda). A política de SELECT já recorta por
     destinatário e por `inapp_allowed`. O teto de 200 existe porque nenhum
     badge precisa dizer mais que "99+", e sem ele o shell pagaria por uma
     varredura que cresce sem limite. */
  const { data: avisos } = await supabase
    .from("notification_outbox")
    .select("event_type")
    .is("read_at", null)
    .limit(200);

  const contagem = new Map<string, number>();
  for (const a of avisos ?? []) {
    const c = categoriaNotificacao(a.event_type);
    contagem.set(c, (contagem.get(c) ?? 0) + 1);
  }
  /* Assinatura vencida acende o item "Planos" — mesmo campo já usado no gate
     de features por plano (`plano_permite`, 20260819210000) e no bloqueio de
     busca/leads (20260819200000), não uma consulta nova. */
  const { data: statusAssinatura } = papel === "profissional"
    ? await supabase.from("professionals").select("subscription_status").eq("id", user.id).single()
    : { data: null };

  /* O item "Pedidos" da distribuidora reaproveita o slot de badge de
     "orcamentos" (mesmo `icone`, ver navegacao.ts) — ela nunca recebe evento
     de quote_requests/quotes, então não há colisão real, só a troca do que
     preenche esse número por papel. */
  const badges: Record<string, number> = {
    notificacoes: avisos?.length ?? 0,
    orcamentos: papel === "distribuidora"
      ? contagem.get("purchase_orders") ?? 0
      : (contagem.get("quote_requests") ?? 0) + (contagem.get("quotes") ?? 0),
    agenda: contagem.get("reminders") ?? 0,
    planos: statusAssinatura?.subscription_status === "inadimplente" ? 1 : 0,
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

        {/* O sino fica fora da lista de navegação de propósito: no celular a
            lista vira uma faixa rolável, e o aviso de "tem coisa nova" não pode
            depender de a pessoa arrastar até achar. Aqui ele está sempre
            visível, nos dois layouts. */}
        <Link href="/painel/notificacoes" className="painel-sino" aria-label={rotuloSino(badges.notificacoes)}>
          <Bell size={18} />
          {badges.notificacoes > 0 && (
            <span aria-hidden className="painel-sino-n">
              {badges.notificacoes > 99 ? "99+" : badges.notificacoes}
            </span>
          )}
        </Link>

        <PainelNav itens={itens} naoLidas={naoLidas ?? 0} badges={badges} />

        <form action={logout} className="painel-sair-wrap">
          <button type="submit" className="painel-sair">Sair</button>
        </form>
      </aside>

      <main className="painel-main" id="conteudo">{children}</main>
    </div>
  );
}
