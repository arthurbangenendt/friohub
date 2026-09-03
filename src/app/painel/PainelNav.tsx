"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Bolt, Wrench, User, Shield, Star, Tool, Droplet, Chat, Doc, MapPin, Building, Sparkle, Move } from "@/components/icons";
import type { UxFeature } from "@/lib/feature-flags";

export type ItemNav = { href: string; label: string; icone: keyof typeof ICONE; feature?: UxFeature };

const ICONE = {
  visao: Bolt, servicos: Wrench, financeiro: Droplet, orcamentos: Doc,
  avaliacoes: Star, ferramentas: Tool, perfil: User, admin: Shield, mensagens: Chat,
  notificacoes: Bell, pmoc: Shield, oportunidades: Bolt, equipamentos: Wrench, clientes: User, desempenho: Bolt,
  // Agenda é trabalho de rua: o alfinete de mapa é o que o técnico procura.
  agenda: MapPin,
  planos: Building,
  assistente: Sparkle,
  // Setas em quatro pontas: sincronização de dados com um sistema externo.
  integracoes: Move,
  importacoes: Doc,
};

/* Único pedaço cliente do shell: só existe para marcar o link ativo, que
   depende do pathname. O resto do layout continua sendo server component. */
export function PainelNav({
  itens, naoLidas = 0, badges = {},
}: {
  itens: ItemNav[];
  naoLidas?: number;
  /** Não lidas por item, chaveado pelo `icone`. Ver o cálculo em `layout.tsx`. */
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();

  return (
    <nav className="painel-nav">
      <span className="painel-nav-t">Navegação</span>
      {itens.map((i) => {
        const Icone = ICONE[i.icone];
        // "/painel" casa exato; as demais casam por prefixo (subrotas ficam ativas).
        const ativo = i.href === "/painel" ? pathname === "/painel" : pathname.startsWith(i.href);
        /* Mensagens tem contagem própria (tabela `messages`), que é mais fiel do
           que derivar da outbox: ela sabe o que foi aberto na conversa. */
        const n = i.icone === "mensagens" ? naoLidas : badges[i.icone] ?? 0;
        return (
          <Link key={i.href} href={i.href} className="painel-link" data-on={String(ativo)}>
            <span className="painel-link-ic"><Icone size={17} /></span>
            {i.label}
            {/* Número, não bolinha: "3 orçamentos esperando" e "12 esperando"
                pedem urgências diferentes, e a bolinha dizia o mesmo para os
                dois casos. */}
            {n > 0 && (
              <>
                <span aria-hidden className="painel-link-n">{n > 99 ? "99+" : n}</span>
                <span className="sr-only">{`, ${n} ${n === 1 ? "não lida" : "não lidas"}`}</span>
              </>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
