"use client";

import { useState, useTransition } from "react";
import { salvarPreferencias, type PreferenciasNotificacao } from "./actions";

const OPCOES: { key: Exclude<keyof PreferenciasNotificacao, "email_enabled">; titulo: string; texto: string }[] = [
  { key: "quote_requests", titulo: "Novos pedidos de orçamento", texto: "Quando um cliente envia um pedido para você." },
  { key: "quotes", titulo: "Propostas e decisões", texto: "Proposta recebida, aceita, recusada ou pedido cancelado." },
  { key: "job_updates", titulo: "Atualizações do serviço", texto: "Mudanças de estado durante o atendimento." },
  { key: "messages", titulo: "Novas mensagens", texto: "Agrupadas em janelas de cinco minutos para evitar spam." },
  { key: "reminders", titulo: "Agenda e lembretes", texto: "Propostas de horário, confirmações e lembretes de atendimento." },
];

export function PreferenciasForm({ inicial }: { inicial: PreferenciasNotificacao }) {
  const [valor, setValor] = useState(inicial);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label className="card" style={{ padding: 18, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
        <input type="checkbox" checked={valor.email_enabled}
          onChange={(event) => setValor((atual) => ({ ...atual, email_enabled: event.target.checked }))} />
        <span>
          <strong style={{ display: "block", fontSize: 15 }}>Receber notificações por e-mail</strong>
          <span style={{ color: "var(--ink-faint)", fontSize: 13 }}>Desative para pausar todos os e-mails transacionais.</span>
        </span>
      </label>

      {OPCOES.map((opcao) => (
        <label key={opcao.key} className="card" style={{
          padding: 18, display: "flex", alignItems: "center", gap: 12,
          cursor: valor.email_enabled ? "pointer" : "not-allowed", opacity: valor.email_enabled ? 1 : 0.55,
        }}>
          <input type="checkbox" checked={valor[opcao.key]} disabled={!valor.email_enabled}
            onChange={(event) => setValor((atual) => ({ ...atual, [opcao.key]: event.target.checked }))} />
          <span>
            <strong style={{ display: "block", fontSize: 14.5 }}>{opcao.titulo}</strong>
            <span style={{ color: "var(--ink-faint)", fontSize: 13 }}>{opcao.texto}</span>
          </span>
        </label>
      ))}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
        <button className="btn btn-primary" disabled={pending}
          onClick={() => startTransition(async () => {
            setMensagem(null);
            const resultado = await salvarPreferencias(valor);
            setMensagem(resultado.ok ? "Preferências salvas." : resultado.error);
          })}>
          {pending ? "Salvando…" : "Salvar preferências"}
        </button>
        {mensagem && <span style={{ fontSize: 13.5, color: mensagem === "Preferências salvas." ? "var(--good)" : "#b3261e" }}>{mensagem}</span>}
      </div>
    </div>
  );
}
