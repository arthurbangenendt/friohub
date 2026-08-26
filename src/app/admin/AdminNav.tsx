"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { GrupoNavAdmin, BadgesAdmin } from "./navegacao";

/* Mesma classe CSS do PainelNav (painel-nav/painel-link/painel-nav-t) — o
   shell é o mesmo, só o conteúdo é agrupado. Um componente novo em vez de
   esticar o PainelNav porque a forma dos dados é diferente (grupos, sem
   ícone obrigatório) e nenhum outro papel precisa de grupo.

   Título e links ficam soltos dentro de `.painel-nav` (Fragment, não uma div
   por grupo): a barra vira linha horizontal rolável no mobile
   (`.painel-nav { flex-direction: row }`, ver globals.css) e cada link
   precisa ser filho direto dela pra isso funcionar — uma div por grupo
   quebraria essa rolagem em blocos. O espaçamento entre grupos já vem do
   padding-top de `.painel-nav-t`, sem precisar de margem extra. */
export function AdminNav({ grupos, badges }: { grupos: GrupoNavAdmin[]; badges: BadgesAdmin }) {
  const pathname = usePathname();

  return (
    <nav className="painel-nav">
      {grupos.map((grupo, gi) => (
        <Fragment key={grupo.titulo ?? `g${gi}`}>
          {grupo.titulo && <span className="painel-nav-t">{grupo.titulo}</span>}
          {grupo.itens.map((item) => {
            // "/admin" casa exato; as demais casam por prefixo (subrotas ficam ativas).
            const ativo = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
            const n = item.badge ? badges[item.badge] : 0;
            return (
              <Link key={item.href} href={item.href} className="painel-link" data-on={String(ativo)}>
                {item.label}
                {n > 0 && (
                  <>
                    <span aria-hidden className="painel-link-n">{n > 99 ? "99+" : n}</span>
                    <span className="sr-only">{`, ${n} aguardando`}</span>
                  </>
                )}
              </Link>
            );
          })}
        </Fragment>
      ))}
    </nav>
  );
}
