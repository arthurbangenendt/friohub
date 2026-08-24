"use client";

import { useState, useTransition } from "react";
import { salvarPreferencias, type PreferenciasNotificacao } from "./actions";
import { Alert, useToast } from "@/components/ui";

type ChaveEmail = "quote_requests" | "quotes" | "job_updates" | "messages" | "reminders";
type ChaveApp = "inapp_quote_requests" | "inapp_quotes" | "inapp_job_updates" | "inapp_messages" | "inapp_reminders";
type ChaveWhats = "whatsapp_quote_requests" | "whatsapp_quotes" | "whatsapp_job_updates" | "whatsapp_messages" | "whatsapp_reminders";

const OPCOES: { email: ChaveEmail; app: ChaveApp; whats: ChaveWhats; titulo: string; texto: string }[] = [
  { email: "quote_requests", app: "inapp_quote_requests", whats: "whatsapp_quote_requests", titulo: "Novos pedidos de orçamento", texto: "Quando um cliente envia um pedido para você." },
  { email: "quotes", app: "inapp_quotes", whats: "whatsapp_quotes", titulo: "Propostas e decisões", texto: "Proposta recebida, aceita, recusada ou pedido cancelado." },
  { email: "job_updates", app: "inapp_job_updates", whats: "whatsapp_job_updates", titulo: "Atualizações do serviço", texto: "Mudanças de estado durante o atendimento." },
  { email: "messages", app: "inapp_messages", whats: "whatsapp_messages", titulo: "Novas mensagens", texto: "Agrupadas em janelas de cinco minutos para evitar spam." },
  { email: "reminders", app: "inapp_reminders", whats: "whatsapp_reminders", titulo: "Agenda e lembretes", texto: "Propostas de horário, confirmações e lembretes de atendimento." },
];

export function PreferenciasForm({ inicial }: { inicial: PreferenciasNotificacao }) {
  const [valor, setValor] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { mostrar } = useToast();

  const alternar = (chave: keyof PreferenciasNotificacao) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValor((atual) => ({ ...atual, [chave]: e.target.checked }));

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* O canal de e-mail ainda não tem entrega implementada. Deixar a coluna
          ativa sem dizer isso seria prometer o que o produto não faz — o mesmo
          critério que a tela de planos usa para a cobrança. */}
      <Alert tipo="info">
        O envio por e-mail e por WhatsApp ainda não estão ativos. Você já pode
        deixar sua escolha registrada: ela passa a valer assim que cada canal
        for ligado. As notificações dentro do app funcionam normalmente.
      </Alert>

      <div className="card" style={{ padding: 18, display: "grid", gap: 14 }}>
        <Interruptor
          titulo="Notificações dentro do app"
          texto="Desative para parar de receber avisos na sua caixa de notificações."
          checked={valor.inapp_enabled}
          onChange={alternar("inapp_enabled")}
        />
        <Interruptor
          titulo="Notificações por e-mail"
          texto="Vale para todos os e-mails transacionais quando o canal for ligado."
          checked={valor.email_enabled}
          onChange={alternar("email_enabled")}
        />
        <Interruptor
          titulo="Notificações por WhatsApp"
          texto="Vale para todas as mensagens de WhatsApp quando o canal for ligado."
          checked={valor.whatsapp_enabled}
          onChange={alternar("whatsapp_enabled")}
        />
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {/* Cabeçalho da grade. Some no leitor de tela porque cada caixa já tem
            rótulo próprio; aqui ele é orientação visual das duas colunas. */}
        <div style={{ ...linha, borderBottom: "1px solid var(--line)", background: "var(--surface-2)" }} aria-hidden>
          <span style={{ flex: 1, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-soft)" }}>
            Evento
          </span>
          <span style={coluna}>No app</span>
          <span style={coluna}>E-mail</span>
          <span style={coluna}>WhatsApp</span>
        </div>

        {OPCOES.map((o, i) => (
          <div key={o.email} style={{ ...linha, borderTop: i === 0 ? "none" : "1px solid var(--line-soft)" }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ display: "block", fontSize: 14.5 }}>{o.titulo}</strong>
              <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>{o.texto}</span>
            </span>
            <Caixa
              rotulo={`${o.titulo} — no app`}
              checked={valor[o.app]}
              disabled={!valor.inapp_enabled}
              onChange={alternar(o.app)}
            />
            <Caixa
              rotulo={`${o.titulo} — por e-mail`}
              checked={valor[o.email]}
              disabled={!valor.email_enabled}
              onChange={alternar(o.email)}
            />
            <Caixa
              rotulo={`${o.titulo} — por WhatsApp`}
              checked={valor[o.whats]}
              disabled={!valor.whatsapp_enabled}
              onChange={alternar(o.whats)}
            />
          </div>
        ))}
      </div>

      {erro && <Alert tipo="erro">{erro}</Alert>}

      <div>
        <button
          className="btn btn-primary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setErro(null);
              const r = await salvarPreferencias(valor);
              if (!r.ok) return setErro(r.error);
              mostrar("Preferências salvas.");
            })
          }
        >
          {pending ? "Salvando…" : "Salvar preferências"}
        </button>
      </div>
    </div>
  );
}

function Interruptor({ titulo, texto, checked, onChange }: {
  titulo: string; texto: string; checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>
        <strong style={{ display: "block", fontSize: 15 }}>{titulo}</strong>
        <span style={{ color: "var(--ink-soft)", fontSize: 13 }}>{texto}</span>
      </span>
    </label>
  );
}

/* O rótulo é invisível mas existe: numa grade de caixas idênticas, sem ele o
   leitor de tela anuncia dez vezes "caixa de seleção" e nada mais. */
function Caixa({ rotulo, checked, disabled, onChange }: {
  rotulo: string; checked: boolean; disabled: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label style={{ ...coluna, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1 }}>
      <span className="sr-only">{rotulo}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
    </label>
  );
}

const linha: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12, padding: "14px 18px",
};
const coluna: React.CSSProperties = {
  width: 64, flexShrink: 0, display: "grid", placeItems: "center",
  fontSize: 12, fontWeight: 700, textTransform: "uppercase",
  letterSpacing: "0.06em", color: "var(--ink-soft)",
};
