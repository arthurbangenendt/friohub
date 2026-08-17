"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "../../Avatar";
import { enviarMensagem } from "../actions";

export type Mensagem = {
  id: string;
  /* Nulo quando o autor não tem perfil no FrioHub: equipe respondendo pelo
     painel do Chatwoot, automação, aviso de sistema. */
  sender_id: string | null;
  sender_kind: string;
  body: string;
  created_at: string;
  canal: string;
  chatwoot_message_id: number | null;
};

/* Nome do canal para quem lê. 'app' não aparece: é o normal, e rotular o normal
   só polui — a etiqueta serve para avisar que a conversa saiu daqui. */
const ROTULO_CANAL: Record<string, string> = {
  whatsapp: "WhatsApp",
  site: "Site",
  email: "E-mail",
  instagram: "Instagram",
  facebook: "Facebook",
  telegram: "Telegram",
  sms: "SMS",
  outro: "Outro canal",
};

const ROTULO_AUTOR: Record<string, string> = {
  equipe: "Equipe FrioHub",
  automacao: "Mensagem automática",
  sistema: "Sistema",
};

export type ParticipanteAuditoria = {
  id: string;
  nome: string;
  avatar: string | null;
  papel: "Cliente" | "Profissional";
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

const RESPOSTAS_RAPIDAS = [
  "Olá! Recebi seu pedido e estou analisando os detalhes.",
  "Posso confirmar algumas informações antes de fechar a proposta?",
  "Minha proposta já está disponível. Se quiser, explico cada item por aqui.",
  "Combinado. Vou confirmar o horário e os materiais necessários.",
];

/* Thread no formato de DM: avatar da outra pessoa colado na bolha, do lado
   esquerdo; as minhas mensagens vão para a direita, sem avatar (é redundante
   saber quem sou eu). O avatar só reaparece quando o autor muda ou quando passa
   muito tempo — repetir a foto em cada linha de uma sequência polui. */
export function Thread({
  conversaId, meuId, outroId, outroNome, outroAvatar, iniciais,
  somenteLeitura = false, participantesAuditoria,
}: {
  conversaId: string;
  meuId: string;
  outroId: string;
  outroNome: string;
  outroAvatar: string | null;
  iniciais: Mensagem[];
  somenteLeitura?: boolean;
  participantesAuditoria?: [ParticipanteAuditoria, ParticipanteAuditoria];
}) {
  const [mensagens, setMensagens] = useState<Mensagem[]>(iniciais);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fimRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  /* Junta mensagens sem duplicar e mantém a ordem cronológica. Três fontes
     escrevem aqui — o retorno do envio, o Realtime e o refresh do servidor —
     e sem dedupe a mesma mensagem apareceria mais de uma vez.

     A chave não é o `id` sozinho. Quando a mensagem vai pelo Chatwoot, quem
     insere em `messages` é o webhook, então o retorno do envio traz uma linha
     otimista com id provisório e a linha real chega depois, pelo Realtime, com
     id de banco. As duas só se reconhecem pelo `chatwoot_message_id`, que é o
     mesmo nas duas pontas. */
  const chave = (m: Mensagem) =>
    m.chatwoot_message_id != null ? `cw:${m.chatwoot_message_id}` : m.id;

  const juntar = (atual: Mensagem[], novas: Mensagem[]) => {
    const porChave = new Map(atual.map((m) => [chave(m), m]));
    for (const m of novas) {
      const k = chave(m);
      const anterior = porChave.get(k);
      /* A linha do banco substitui a otimista, nunca o contrário: o Realtime
         pode chegar ANTES do retorno do envio, e nesse caso o retorno não pode
         rebaixar a versão definitiva. */
      if (anterior && m.id.startsWith("pendente:")) continue;
      porChave.set(k, m);
    }
    return [...porChave.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
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
            {somenteLeitura ? "Conversa aberta, mas nenhuma mensagem foi enviada." : "Nenhuma mensagem ainda. Escreva a primeira."}
          </p>
        )}

        {mensagens.map((m, i) => {
          const meu = m.sender_id !== null && m.sender_id === meuId;
          const autorAuditoria = participantesAuditoria?.find((participante) => participante.id === m.sender_id);
          /* Equipe, automação e sistema não são "o outro participante": vão
             centralizadas, com etiqueta, para ninguém achar que foi a pessoa do
             outro lado que escreveu aquilo. */
          const deTerceiro = m.sender_kind === "equipe" || m.sender_kind === "automacao" || m.sender_kind === "sistema";
          const alinhadaDireita = somenteLeitura
            ? autorAuditoria?.papel === "Profissional"
            : meu;
          const rotuloCanal = ROTULO_CANAL[m.canal];
          const anterior = mensagens[i - 1];
          const novoDia = !anterior || diaLabel(anterior.created_at) !== diaLabel(m.created_at);
          const inicioDaSequencia = !anterior || anterior.sender_id !== m.sender_id;
          // Última de uma sequência do mesmo autor: é nela que o avatar aparece.
          const proxima = mensagens[i + 1];
          const fimDaSequencia = !proxima || proxima.sender_id !== m.sender_id;

          if (deTerceiro) {
            return (
              <div key={chave(m)}>
                {novoDia && (
                  <div style={{ textAlign: "center", fontSize: 12, color: "var(--ink-faint)", margin: "16px 0 10px" }}>
                    {diaLabel(m.created_at)}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "center", margin: "6px 0 10px" }}>
                  <div
                    title={hora(m.created_at)}
                    style={{
                      maxWidth: "84%",
                      border: "1px solid var(--line)",
                      borderRadius: 14,
                      background: "var(--surface-2)",
                      color: "var(--ink-soft)",
                      padding: "9px 14px",
                      fontSize: 13.5,
                      lineHeight: 1.45,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    <div style={{ fontSize: 11.5, fontWeight: 650, color: "var(--ink-faint)", marginBottom: 3 }}>
                      {ROTULO_AUTOR[m.sender_kind] ?? "FrioHub"}
                      {rotuloCanal ? ` · ${rotuloCanal}` : ""}
                    </div>
                    {m.body}
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={chave(m)}>
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
                  justifyContent: alinhadaDireita ? "flex-end" : "flex-start",
                  marginBottom: fimDaSequencia ? 8 : 2,
                }}
              >
                {!alinhadaDireita && (
                  <span style={{ width: 28, flexShrink: 0 }}>
                    {fimDaSequencia && (
                      <Avatar
                        nome={autorAuditoria?.nome ?? outroNome}
                        id={autorAuditoria?.id ?? outroId}
                        url={autorAuditoria?.avatar ?? outroAvatar}
                        size={28}
                      />
                    )}
                  </span>
                )}
                <div style={{ maxWidth: "72%", minWidth: 0 }}>
                  {somenteLeitura && inicioDaSequencia && (
                    <div style={{
                      margin: alinhadaDireita ? "0 4px 4px 0" : "0 0 4px 4px",
                      textAlign: alinhadaDireita ? "right" : "left",
                      color: "var(--ink-faint)", fontSize: 11.5, fontWeight: 650,
                    }}>
                      {autorAuditoria?.nome ?? "Participante"} · {autorAuditoria?.papel ?? "Participante"}
                    </div>
                  )}
                  {/* Só quando a mensagem NÃO veio pelo app: saber que a pessoa
                      respondeu do WhatsApp muda a expectativa de resposta. */}
                  {rotuloCanal && inicioDaSequencia && (
                    <div style={{
                      margin: alinhadaDireita ? "0 4px 4px 0" : "0 0 4px 4px",
                      textAlign: alinhadaDireita ? "right" : "left",
                      color: "var(--ink-faint)", fontSize: 11,
                    }}>
                      via {rotuloCanal}
                    </div>
                  )}
                  <div
                    title={hora(m.created_at)}
                    style={{
                      padding: "9px 14px",
                      borderRadius: 18,
                      // No modo auditoria, cliente fica à esquerda e profissional à direita.
                      borderBottomRightRadius: alinhadaDireita && fimDaSequencia ? 5 : 18,
                      borderBottomLeftRadius: !alinhadaDireita && fimDaSequencia ? 5 : 18,
                      background: alinhadaDireita ? "var(--cool)" : "var(--surface-2)",
                      color: alinhadaDireita ? "#fff" : "var(--ink)",
                      fontSize: 14.5,
                      lineHeight: 1.45,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {m.body}
                  </div>
                </div>
                {somenteLeitura && alinhadaDireita && (
                  <span style={{ width: 28, flexShrink: 0 }}>
                    {fimDaSequencia && autorAuditoria && (
                      <Avatar nome={autorAuditoria.nome} id={autorAuditoria.id} url={autorAuditoria.avatar} size={28} />
                    )}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={fimRef} />
      </div>

      {somenteLeitura ? (
        <div className="chat-auditoria-rodape">
          Esta conversa é exibida para fins de suporte e auditoria. O administrador não pode enviar, editar ou apagar mensagens.
        </div>
      ) : (
        <>
          {erro && <p style={{ color: "var(--danger)", fontSize: 13.5, margin: 0 }}>{erro}</p>}

          <div aria-label="Respostas rápidas" style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 2 }}>
            {RESPOSTAS_RAPIDAS.map((resposta) => (
              <button
                key={resposta}
                type="button"
                onClick={() => setTexto(resposta)}
                style={{ flex: "0 0 auto", border: "1px solid var(--line)", borderRadius: 100, background: "var(--surface)", color: "var(--ink-soft)", padding: "7px 11px", font: "inherit", fontSize: 12.5, cursor: "pointer" }}
              >
                {resposta.length > 45 ? `${resposta.slice(0, 45)}…` : resposta}
              </button>
            ))}
          </div>
          <p style={{ margin: "-7px 2px 0", color: "var(--ink-faint)", fontSize: 11.5 }}>
            A resposta escolhida vai para o campo abaixo: revise antes de enviar.
          </p>

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
        </>
      )}
    </div>
  );
}
