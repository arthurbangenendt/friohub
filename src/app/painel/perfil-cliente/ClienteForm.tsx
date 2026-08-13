"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { salvarPerfilCliente } from "./actions";
import { formatarTelefone, validarTelefone } from "@/lib/documento";

export function ClienteForm({ nomeInicial, telefoneInicial }: { nomeInicial: string; telefoneInicial: string }) {
  const router = useRouter();
  const [nome, setNome] = useState(nomeInicial);
  const [telefone, setTelefone] = useState(formatarTelefone(telefoneInicial));
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const telInvalido = telefone.trim() !== "" && !validarTelefone(telefone);

  function salvar() {
    setErro(null);
    setSalvo(false);
    start(async () => {
      const r = await salvarPerfilCliente({ nome, telefone });
      if (r.ok) { setSalvo(true); router.refresh(); }
      else setErro(r.error);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <label style={campo}>
        <span style={rotulo}>Nome completo</span>
        <input value={nome} onChange={(e) => setNome(e.target.value)} style={input} placeholder="Seu nome" />
      </label>

      <label style={campo}>
        <span style={rotulo}>Telefone / WhatsApp</span>
        <input value={telefone} onChange={(e) => setTelefone(formatarTelefone(e.target.value))}
          inputMode="numeric" style={input} placeholder="(11) 90000-0000" />
        {/* O texto anterior prometia que "o profissional do seu serviço vê seu telefone",
            o que nunca foi verdade: `profile_private` só é legível pelo próprio dono.
            A conversa acontece no chat, e o telefone só sai daqui se as duas partes
            concordarem em trocar contato. */}
        <span style={{ fontSize: 12.5, color: telInvalido ? "#b3261e" : "var(--ink-faint)" }}>
          {telInvalido
            ? "Telefone incompleto."
            : "Seu telefone fica privado — não aparece em página pública nem para o profissional. A conversa acontece pelo chat, e o número só é compartilhado se vocês dois autorizarem."}
        </span>
      </label>

      {erro && <p style={{ color: "#b3261e", fontSize: 14, margin: 0 }}>{erro}</p>}
      {salvo && <p style={{ color: "var(--good)", fontSize: 14, fontWeight: 600, margin: 0 }}>Perfil salvo!</p>}

      <button className="btn btn-primary" onClick={salvar} disabled={pending || telInvalido}
        style={{ alignSelf: "flex-start", opacity: pending ? 0.7 : 1 }}>
        {pending ? "Salvando..." : "Salvar"}
      </button>
    </div>
  );
}

const campo: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 7 };
const rotulo: React.CSSProperties = { fontSize: 13.5, fontWeight: 650, color: "var(--ink-soft)" };
const input: React.CSSProperties = { height: 44, padding: "0 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: 15, width: "100%" };
