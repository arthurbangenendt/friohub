"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bolt, Wrench, User, Shield, Star, Tool, Droplet, Chat, Doc } from "@/components/icons";

export type ItemNav = { href: string; label: string; icone: keyof typeof ICONE };

const ICONE = {
  visao: Bolt, servicos: Wrench, financeiro: Droplet, orcamentos: Doc,
  avaliacoes: Star, ferramentas: Tool, perfil: User, admin: Shield, mensagens: Chat,
};

/* Único pedaço cliente do shell: só existe para marcar o link ativo, que
   depende do pathname. O resto do layout continua sendo server component. */
export function PainelNav({ itens, naoLidas = 0 }: { itens: ItemNav[]; naoLidas?: number }) {
  const pathname = usePathname();

  return (
    <nav className="painel-nav">
      <span className="painel-nav-t">Navegação</span>
      {itens.map((i) => {
        const Icone = ICONE[i.icone];
        // "/painel" casa exato; as demais casam por prefixo (subrotas ficam ativas).
        const ativo = i.href === "/painel" ? pathname === "/painel" : pathname.startsWith(i.href);
        const marcar = i.icone === "mensagens" && naoLidas > 0;
        return (
          <Link key={i.href} href={i.href} className="painel-link" data-on={String(ativo)}>
            <span className="painel-link-ic"><Icone size={17} /></span>
            {i.label}
            {/* Bolinha, não contador: o menu só precisa dizer "tem coisa nova". */}
            {marcar && (
              <span
                aria-label={`${naoLidas} não lidas`}
                style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--cool)", marginLeft: "auto" }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
