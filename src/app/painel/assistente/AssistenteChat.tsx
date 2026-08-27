"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { criarConversa, apagarConversa, listarMensagens, type Conversa, type MensagemAssistente } from "./actions";

/* Modelada em `painel/mensagens/[id]/Thread.tsx`: mesmas bolhas
   (var(--cool) para o usuário, var(--surface-2) para a IA), inline style +
   CSS vars — sem Tailwind utilitário nem shadcn, seguindo o padrão do resto
   do painel.

   A chamada de rede em si (streaming) fica na rota `/api/assistente/chat`,
   construída à parte. Este componente já fala o contrato dela: POST
   {conversationId, message} -> corpo da resposta é o texto em streaming. */

type MensagemView = MensagemAssistente | { id: string; role: "assistant"; content: string; created_at: string; pendente: true };

export function AssistenteChat({
  conversasIniciais,
  orcamentoParaAbrir,
}: {
  conversasIniciais: Conversa[];
  orcamentoParaAbrir: string | null;
}) {
  const router = useRouter();
  const [conversas, setConversas] = useState(conversasIniciais);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<MensagemView[]>([]);
  const [texto, setTexto] = useState("");
  const [carregandoThread, setCarregandoThread] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fimRef = useRef<HTMLDivElement>(null);
  const abriuOrcamento = useRef(false);

  async function selecionarConversa(id: string) {
    setConversaId(id);
    setErro(null);
    setCarregandoThread(true);
    const r = await listarMensagens(id);
    setCarregandoThread(false);
    if (!r.ok) return setErro(r.error);
    setMensagens(r.mensagens);
  }

  async function novaConversa(quoteRequestId?: string) {
    setErro(null);
    const r = await criarConversa(quoteRequestId);
    if (!r.ok) return setErro(r.error);
    setConversas((atual) => [r.conversa, ...atual]);
    setConversaId(r.conversa.id);
    setMensagens([]);
    return r.conversa.id;
  }

  // Chegada via "Pedir análise da IA" num orçamento: abre direto no modo
  // triagem, uma única vez por visita à página.
  useEffect(() => {
    if (!orcamentoParaAbrir || abriuOrcamento.current) return;
    abriuOrcamento.current = true;
    startTransition(async () => {
      const existente = conversas.find((c) => c.quote_request_id === orcamentoParaAbrir);
      if (existente) {
        await selecionarConversa(existente.id);
      } else {
        await novaConversa(orcamentoParaAbrir);
      }
      router.replace("/painel/assistente");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orcamentoParaAbrir]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensagens.length]);

  async function enviar() {
    const corpo = texto.trim();
    if (!corpo || enviando) return;
    setErro(null);
    setTexto("");

    let idAtual = conversaId;
    if (!idAtual) {
      idAtual = (await novaConversa()) ?? null;
      if (!idAtual) return;
    }

    const mensagemUsuario: MensagemView = {
      id: `pendente:${crypto.randomUUID()}`,
      role: "user",
      content: corpo,
      created_at: new Date().toISOString(),
    };
    const respostaId = `pendente:${crypto.randomUUID()}`;
    setMensagens((atual) => [
      ...atual,
      mensagemUsuario,
      { id: respostaId, role: "assistant", content: "", created_at: new Date().toISOString(), pendente: true },
    ]);
    setEnviando(true);

    try {
      const resposta = await fetch("/api/assistente/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: idAtual, message: corpo }),
      });

      if (!resposta.ok || !resposta.body) {
        const erroJson = await resposta.json().catch(() => null);
        throw new Error(erroJson?.error ?? "Não foi possível falar com o assistente agora.");
      }

      const reader = resposta.body.getReader();
      const decoder = new TextDecoder();
      let acumulado = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acumulado += decoder.decode(value, { stream: true });
        setMensagens((atual) =>
          atual.map((m) => (m.id === respostaId ? { ...m, content: acumulado } : m)),
        );
      }

      // A rota pode fechar o stream sem erro HTTP e sem texto nenhum (ex.: a
      // OpenAI cortou no meio por content filter) — sem isto, a bolha fica
      // presa em "…" para sempre, sem erro visível nem forma de tentar de novo.
      if (!acumulado.trim()) {
        throw new Error("O assistente não conseguiu responder. Tente novamente.");
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível falar com o assistente agora.");
      setMensagens((atual) => atual.filter((m) => m.id !== respostaId));
      setTexto(corpo);
    } finally {
      setEnviando(false);
      startTransition(() => router.refresh());
    }
  }

  function remover(id: string) {
    startTransition(async () => {
      const r = await apagarConversa(id);
      if (!r.ok) return setErro(r.error);
      setConversas((atual) => atual.filter((c) => c.id !== id));
      if (conversaId === id) {
        setConversaId(null);
        setMensagens([]);
      }
    });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => novaConversa()}
          disabled={pending}
          style={{ width: "100%", marginBottom: 8 }}
        >
          Nova conversa
        </button>
        {conversas.map((c) => (
          <div
            key={c.id}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              borderRadius: 10, padding: "8px 10px",
              background: c.id === conversaId ? "var(--surface-2)" : "transparent",
              cursor: "pointer",
            }}
          >
            <button
              type="button"
              onClick={() => selecionarConversa(c.id)}
              style={{
                flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none",
                font: "inherit", fontSize: 13.5, color: "var(--ink)", cursor: "pointer",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: 0,
              }}
            >
              {c.title}
            </button>
            <button
              type="button"
              onClick={() => remover(c.id)}
              aria-label="Apagar conversa"
              style={{ border: "none", background: "none", color: "var(--ink-faint)", cursor: "pointer", fontSize: 13 }}
            >
              ×
            </button>
          </div>
        ))}
        {conversas.length === 0 && (
          <p style={{ color: "var(--ink-faint)", fontSize: 12.5, padding: "0 4px" }}>Nenhuma conversa ainda.</p>
        )}
      </div>

      <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          style={{
            display: "flex", flexDirection: "column", gap: 3,
            minHeight: 340, maxHeight: "58vh", overflowY: "auto",
            padding: "6px 2px",
          }}
        >
          {carregandoThread ? (
            <p style={{ color: "var(--ink-faint)", fontSize: 14, textAlign: "center", margin: "auto" }}>Carregando…</p>
          ) : mensagens.length === 0 ? (
            <p style={{ color: "var(--ink-faint)", fontSize: 14, textAlign: "center", margin: "auto" }}>
              Pergunte sobre dimensionamento, instalação, diagnóstico ou peça uma análise de orçamento.
            </p>
          ) : (
            mensagens.map((m) => (
              <div
                key={m.id}
                style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 8 }}
              >
                <div
                  style={{
                    maxWidth: "78%",
                    padding: "9px 14px",
                    borderRadius: 18,
                    background: m.role === "user" ? "var(--cool)" : "var(--surface-2)",
                    color: m.role === "user" ? "#fff" : "var(--ink)",
                    fontSize: 14.5,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {m.content || ("pendente" in m && m.pendente ? "…" : "")}
                </div>
              </div>
            ))
          )}
          <div ref={fimRef} />
        </div>

        {erro && <p style={{ color: "var(--danger)", fontSize: 13.5, margin: 0 }}>{erro}</p>}

        <p style={{ margin: 0, color: "var(--ink-faint)", fontSize: 11.5 }}>
          Respostas geradas por IA — confira antes de repassar ao cliente ou aplicar em campo.
        </p>

        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar();
              }
            }}
            rows={1}
            placeholder="Escreva sua pergunta…"
            disabled={enviando}
            style={{
              flex: 1, resize: "none", padding: "12px 16px", borderRadius: 22,
              border: "1px solid var(--line)", background: "var(--surface)",
              fontSize: 14.5, fontFamily: "inherit", color: "var(--ink)", maxHeight: 140,
            }}
          />
          <button
            className="btn btn-primary"
            onClick={enviar}
            disabled={enviando || !texto.trim()}
            style={{ height: 44, padding: "0 20px", borderRadius: 22 }}
          >
            {enviando ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}
