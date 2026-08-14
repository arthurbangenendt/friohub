"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { marcarLida, marcarTodasLidas } from "./actions";
import { tempoRelativo, type NotificacaoView } from "@/lib/notificacoes";
import { TOM } from "@/lib/status";
import { EmptyState, useToast } from "@/components/ui";
import { Bell } from "@/components/icons";

export function ListaNotificacoes({ itens, temNaoLidas }: { itens: NotificacaoView[]; temNaoLidas: boolean }) {
  const router = useRouter();
  const { mostrar } = useToast();
  const [pending, startTransition] = useTransition();

  if (itens.length === 0) {
    return (
      <EmptyState
        icone={<Bell size={22} />}
        titulo="Nenhuma notificação por aqui"
        descricao="Avisos sobre pedidos, propostas, mensagens e agenda aparecem nesta lista assim que acontecerem."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {temNaoLidas && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            className="btn btn-ghost"
            style={{ height: 36, padding: "0 14px", fontSize: 13.5 }}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await marcarTodasLidas();
                if (!r.ok) return mostrar(r.error, "erro");
                mostrar("Tudo marcado como lido.");
                router.refresh();
              })
            }
          >
            {pending ? "Marcando…" : "Marcar todas como lidas"}
          </button>
        </div>
      )}

      {itens.map((n) => (
        <Item key={n.id} n={n} />
      ))}
    </div>
  );
}

function Item({ n }: { n: NotificacaoView }) {
  const [pending, startTransition] = useTransition();
  const tom = TOM[n.tom];

  /* Abrir a notificação já a marca como lida — ninguém quer clicar duas vezes
     para dar baixa em algo que acabou de ler. A navegação não espera a
     confirmação do servidor: `marcarLida` é idempotente e, se falhar, o pior
     caso é o aviso continuar em negrito. */
  const abrir = () => {
    if (!n.lida) startTransition(() => { void marcarLida(n.id); });
  };

  const corpo = (
    <>
      {/* A barra colorida à esquerda é o que diferencia "proposta aceita" de
          "pedido cancelado" numa varredura rápida da lista. */}
      <span aria-hidden style={{ width: 3, alignSelf: "stretch", borderRadius: 3, background: tom.cor, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14.5, fontWeight: n.lida ? 550 : 750 }}>{n.titulo}</strong>
          <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>{tempoRelativo(n.criadaEm)}</span>
        </span>
        {n.detalhe && (
          <span style={{ display: "block", fontSize: 13, color: "var(--ink-soft)", marginTop: 3 }}>{n.detalhe}</span>
        )}
      </span>
      {!n.lida && (
        <>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--cool)", flexShrink: 0 }} />
          <span className="sr-only">Não lida</span>
        </>
      )}
    </>
  );

  const estilo: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 12,
    padding: "14px 16px", borderRadius: 13,
    background: n.lida ? "var(--surface)" : "var(--bg-subtle)",
    border: "1px solid var(--line)",
    color: "inherit", textAlign: "left", width: "100%",
    opacity: pending ? 0.7 : 1,
  };

  /* Sem destino conhecido não vira link: um <a> que não leva a lugar nenhum é
     pior do que um bloco de texto honesto. */
  if (!n.href) {
    return (
      <button type="button" onClick={abrir} style={{ ...estilo, cursor: n.lida ? "default" : "pointer", font: "inherit" }}>
        {corpo}
      </button>
    );
  }

  return (
    <Link href={n.href} onClick={abrir} onAuxClick={abrir} style={estilo}>
      {corpo}
    </Link>
  );
}
