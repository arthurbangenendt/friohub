"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { atribuirPmoc, cancelarPmoc, concluirVisitaPmoc, responderPmoc, solicitarPmoc } from "./actions";

const input: React.CSSProperties = {
  height: 43, padding: "0 12px", borderRadius: 10, border: "1px solid var(--line)",
  background: "var(--bg)", color: "var(--ink)", fontSize: 14, width: "100%",
};
const label: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 650 };

function Mensagem({ erro, sucesso }: { erro: string | null; sucesso?: string | null }) {
  if (!erro && !sucesso) return null;
  return <p role="status" style={{ margin: 0, fontSize: 13.5, color: erro ? "#b3261e" : "var(--good)" }}>{erro ?? sucesso}</p>;
}

export function SolicitarPmocForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  return (
    <form className="card" style={{ padding: 20, display: "grid", gap: 14 }} onSubmit={(event) => {
      event.preventDefault();
      setErro(null); setSucesso(null);
      const data = new FormData(event.currentTarget);
      start(async () => {
        const result = await solicitarPmoc({
          empresa: String(data.get("empresa") ?? ""), unidade: String(data.get("unidade") ?? ""),
          cep: String(data.get("cep") ?? ""), equipamentos: Number(data.get("equipamentos")),
          intervaloMeses: Number(data.get("intervalo")), observacoes: String(data.get("observacoes") ?? ""),
        });
        if (!result.ok) setErro(result.error);
        else { setSucesso("Solicitação enviada para análise."); (event.target as HTMLFormElement).reset(); router.refresh(); }
      });
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
        <label style={label}>Empresa<input name="empresa" required minLength={2} maxLength={160} style={input} /></label>
        <label style={label}>Unidade atendida<input name="unidade" required minLength={2} maxLength={160} style={input} placeholder="Matriz, loja Centro…" /></label>
        <label style={label}>CEP<input name="cep" required inputMode="numeric" pattern="[0-9. -]{8,10}" style={input} /></label>
        <label style={label}>Quantidade de equipamentos<input name="equipamentos" required type="number" min={1} max={10000} style={input} /></label>
        <label style={label}>Periodicidade
          <select name="intervalo" defaultValue="3" style={input}>
            <option value="1">Mensal</option><option value="2">Bimestral</option><option value="3">Trimestral</option>
            <option value="6">Semestral</option><option value="12">Anual</option>
          </select>
        </label>
      </div>
      <label style={label}>Observações<textarea name="observacoes" maxLength={4000} rows={4} style={{ ...input, height: "auto", padding: 12, resize: "vertical" }} /></label>
      <Mensagem erro={erro} sucesso={sucesso} />
      <button className="btn btn-primary" disabled={pending} style={{ justifySelf: "start" }}>{pending ? "Enviando…" : "Solicitar PMOC"}</button>
    </form>
  );
}

export function ResponderPmocForm({ planoId }: { planoId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  function executar(aceitar: boolean, form?: HTMLFormElement) {
    setErro(null);
    const data = form ? new FormData(form) : new FormData();
    start(async () => {
      const result = await responderPmoc({ planoId, aceitar, valorPorVisita: Number(data.get("valor")), primeiraVisita: String(data.get("data") ?? "") });
      if (!result.ok) setErro(result.error); else router.refresh();
    });
  }
  return (
    <form style={{ display: "grid", gap: 10, marginTop: 14 }} onSubmit={(e) => { e.preventDefault(); executar(true, e.currentTarget); }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label style={label}>Valor por visita (R$)<input name="valor" required type="number" min="0.01" step="0.01" style={input} /></label>
        <label style={label}>Primeira visita<input name="data" required type="date" style={input} /></label>
      </div>
      <Mensagem erro={erro} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary" disabled={pending}>{pending ? "Salvando…" : "Aceitar PMOC"}</button>
        <button className="btn" type="button" disabled={pending} onClick={() => executar(false)}>Recusar</button>
      </div>
    </form>
  );
}

export function ConcluirVisitaForm({ visitaId }: { visitaId: string }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [erro, setErro] = useState<string | null>(null);
  return <form style={{ display: "grid", gap: 8, marginTop: 8 }} onSubmit={(e) => {
    e.preventDefault(); const data = new FormData(e.currentTarget); setErro(null);
    start(async () => { const r = await concluirVisitaPmoc(visitaId, String(data.get("observacoes") ?? "")); if (!r.ok) setErro(r.error); else router.refresh(); });
  }}>
    <textarea name="observacoes" maxLength={4000} rows={2} style={{ ...input, height: "auto", padding: 10 }} placeholder="O que foi executado nesta visita?" />
    <Mensagem erro={erro} /><button className="btn btn-primary" disabled={pending} style={{ justifySelf: "start" }}>{pending ? "Concluindo…" : "Marcar como concluída"}</button>
  </form>;
}

export function CancelarPmocForm({ planoId }: { planoId: string }) {
  const router = useRouter(); const [aberto, setAberto] = useState(false); const [pending, start] = useTransition(); const [erro, setErro] = useState<string | null>(null);
  if (!aberto) return <button className="btn" onClick={() => setAberto(true)}>Cancelar plano</button>;
  return <form style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }} onSubmit={(e) => {
    e.preventDefault(); const data = new FormData(e.currentTarget); setErro(null);
    start(async () => { const r = await cancelarPmoc(planoId, String(data.get("motivo") ?? "")); if (!r.ok) setErro(r.error); else router.refresh(); });
  }}>
    <label style={{ ...label, flex: "1 1 240px" }}>Motivo<input name="motivo" required minLength={5} maxLength={500} style={input} /></label>
    <button className="btn" disabled={pending}>{pending ? "Cancelando…" : "Confirmar cancelamento"}</button><Mensagem erro={erro} />
  </form>;
}

export function AtribuirPmocForm({ planoId, profissionais }: { planoId: string; profissionais: { id: string; nome: string }[] }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [erro, setErro] = useState<string | null>(null);
  return <form style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }} onSubmit={(e) => {
    e.preventDefault(); const data = new FormData(e.currentTarget); setErro(null);
    start(async () => { const r = await atribuirPmoc(planoId, String(data.get("profissional") ?? "")); if (!r.ok) setErro(r.error); else router.refresh(); });
  }}>
    <label style={{ ...label, flex: "1 1 240px" }}>Profissional elegível<select name="profissional" required defaultValue="" style={input}><option value="" disabled>Selecione…</option>{profissionais.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
    <button className="btn btn-primary" disabled={pending || profissionais.length === 0}>{pending ? "Atribuindo…" : "Enviar oferta"}</button><Mensagem erro={erro} />
  </form>;
}
