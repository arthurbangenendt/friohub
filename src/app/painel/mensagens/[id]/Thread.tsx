"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "../../Avatar";
import { enviarMensagem } from "../actions";

export type Mensagem = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const diaLabel = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
};

/* Thread no formato de DM: avatar da outra pessoa colado na bolha, do lado
   esquerdo; as minhas mensagens vão para a direita, sem avatar (é redundante
   saber quem sou eu). O avatar só reaparece quando o autor muda ou quando passa
   muito tempo — repetir a foto em cada linha de uma sequência polui. */
export function Thread({
  conversaId, meuId, outroId, outroNome, outroAvatar, iniciais,
}: {
  conversaId: string;
  meuId: string;
  outroId: string;
  outroNome: string;
  outroAvatar: string | null;
  iniciais: Mensagem[];
}) {
  const [mensagens, setMensagens] = useState<Mensagem[]>(iniciais);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fimRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  /* Junta mensagens sem duplicar e mantém a ordem cronológica. Três fontes
     escrevem aqui — o retorno do envio, o Realtime e o refresh do servidor —
     e sem dedupe por id a mesma mensagem apareceria mais de uma vez. */
  const juntar = (atual: Mensagem[], novas: Mensagem[]) => {
    const porId = new Map(atual.map((m) => [m.id, m]));
    for (const m of novas) porId.set(m.id, m);
    return [...porId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  };

  /* `useState` só usa o valor inicial na montagem: quando o server component
     re-renderiza depois de `revalidatePath`, as props novas NÃO entram sozinhas
     no estado. Sem isto, a mensagem era gravada no banco e não aparecia.
     Ajuste durante o render (e não em efeito) é o padrão recomendado do React
     para sincronizar estado com prop que mudou: evita o render descartado. */
  const [vistas, setVistas] = useState(iniciais);
  if (vistas !== iniciais) {
    setVistas(iniciais);
    setMensagens((atual) => juntar(atual, iniciais));
  }

  /* Realtime é REFORÇO, não a fonte única: se o socket não autenticar, a thread
     continua correta pelo retorno do envio e pelo refresh do servidor. */
  useEffect(() => {
    const supabase = createClient();
    const canal = supabase
      .channel(`conversa:${conversaId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversaId}` },
        (payload) => {
          const nova = payload.new as Mensagem;
          setMensagens((atual) => juntar(atual, [nova]));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [conversaId]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensagens.length]);

  /* Rede de segurança para quem RECEBE: o remetente já vê a própria mensagem
     pelo retorno do envio, mas o outro lado depende do Realtime. Se o socket
     cair ou não autenticar, voltar à aba recarrega a thread do servidor. */
  useEffect(() => {
    const aoFocar = () => router.refresh();
    window.addEventListener("focus", aoFocar);
    return () => window.removeEventListener("focus", aoFocar);
  }, [router]);

  function enviar() {
    const corpo = texto.trim();
    if (!corpo || pending) return;
    setErro(null);
    setTexto("");
    startTransition(async () => {
      const r = await enviarMensagem(conversaId, corpo);
      if (!r.ok) {
        setErro(r.error);
        setTexto(corpo); // devolve o texto para a pessoa não perder o que escreveu
        return;
      }
      // A linha vem do banco (id e created_at reais), então o dedupe com o
      // Realtime funciona e a ordem não quebra.
      setMensagens((atual) => juntar(atual, [r.mensagem]));
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          display: "flex", flexDirection: "column", gap: 3,
          minHeight: 320, maxHeight: "58vh", overflowY: "auto",
          padding: "6px 2px",
        }}
      >
        {mensagens.length === 0 && (
          <p style={{ color: "var(--ink-faint)", fontSize: 14, textAlign: "center", margin: "auto" }}>
            Nenhuma mensagem ainda. Escreva a primeira.
          </p>
        )}

        {mensagens.map((m, i) => {
          const meu = m.sender_id === meuId;
          const anterior = mensagens[i - 1];
          const novoDia = !anterior || diaLabel(anterior.created_at) !== diaLabel(m.created_at);
          // Última de uma sequência do mesmo autor: é nela que o avatar aparece.
          const proxima = mensagens[i + 1];
          const fimDaSequencia = !proxima || proxima.sender_id !== m.sender_id;

          return (
            <div key={m.id}>
              {novoDia && (
                <div style={{ textAlign: "center", fontSize: 12, color: "var(--ink-faint)", margin: "16px 0 10px" }}>
                  {diaLabel(m.created_at)}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-end",
                  justifyContent: meu ? "flex-end" : "flex-start",
                  marginBottom: fimDaSequencia ? 8 : 2,
                }}
              >
                {!meu && (
                  <span style={{ width: 28, flexShrink: 0 }}>
                    {fimDaSequencia && (
                      <Avatar nome={outroNome} id={outroId} url={outroAvatar} size={28} />
                    )}
                  </span>
                )}
                <div
                  title={hora(m.created_at)}
                  style={{
                    maxWidth: "72%",
                    padding: "9px 14px",
                    borderRadius: 18,
                    // Canto "colado" no lado de quem falou, como em app de mensagem.
                    borderBottomRightRadius: meu && fimDaSequencia ? 5 : 18,
                    borderBottomLeftRadius: !meu && fimDaSequencia ? 5 : 18,
                    background: meu ? "var(--cool)" : "var(--surface-2)",
                    color: meu ? "#fff" : "var(--ink)",
                    fontSize: 14.5,
                    lineHeight: 1.45,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {m.body}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={fimRef} />
      </div>

      {erro && <p style={{ color: "#b3261e", fontSize: 13.5, margin: 0 }}>{erro}</p>}

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // Enter envia; Shift+Enter quebra linha — convenção de app de chat.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              enviar();
            }
          }}
          rows={1}
          placeholder="Escreva uma mensagem…"
          style={{
            flex: 1, resize: "none", padding: "12px 16px", borderRadius: 22,
            border: "1px solid var(--line)", background: "var(--surface)",
            fontSize: 14.5, fontFamily: "inherit", color: "var(--ink)", maxHeight: 140,
          }}
        />
        <button
          className="btn btn-primary"
          onClick={enviar}
          disabled={pending || !texto.trim()}
          style={{ height: 44, padding: "0 20px", borderRadius: 22 }}
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
