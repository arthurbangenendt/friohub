"use client";

import { useState, useTransition } from "react";
import { formatarTelefone } from "@/lib/documento";
import { registrarInteresseDistribuidora } from "./actions";

const campo: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const rotulo: React.CSSProperties = { fontSize: 13, fontWeight: 650, color: "#b8d3da" };
const input: React.CSSProperties = {
  height: 44, padding: "0 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,.22)",
  background: "rgba(255,255,255,.06)", color: "#eaf3f5", fontSize: 14.5,
};

/* Substitui o link direto pra /signup?role=distribuidora — cadastro fica sob
 * controle do admin (ver 20260824130000_interesse_distribuidora.sql). Esse
 * formulário só registra o contato; o time decide quando chamar. */
export function FormularioInteresse() {
  const [nome, setNome] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [cidade, setCidade] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);

  function enviar() {
    setErro(null);
    start(async () => {
      const r = await registrarInteresseDistribuidora({ nome, empresa, telefone, email, cidade, mensagem });
      if (!r.ok) return setErro(r.error);
      setEnviado(true);
    });
  }

  if (enviado) {
    return (
      <div style={{ padding: "20px 22px", borderRadius: 12, background: "rgba(255,255,255,.08)", maxWidth: 480 }}>
        <strong style={{ display: "block", fontSize: 16, marginBottom: 4 }}>Recebemos seu contato.</strong>
        <span style={{ color: "#b8d3da", fontSize: 14 }}>A equipe FrioHub entra em contato pra seguir com o cadastro.</span>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 480 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
        <label style={campo}>
          <span style={rotulo}>Seu nome</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} style={input} placeholder="Seu nome" />
        </label>
        <label style={campo}>
          <span style={rotulo}>Distribuidora</span>
          <input value={empresa} onChange={(e) => setEmpresa(e.target.value)} style={input} placeholder="Razão social" />
        </label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
        <label style={campo}>
          <span style={rotulo}>Telefone</span>
          <input value={telefone} onChange={(e) => setTelefone(formatarTelefone(e.target.value))} inputMode="numeric" style={input} placeholder="(11) 90000-0000" />
        </label>
        <label style={campo}>
          <span style={rotulo}>E-mail</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" style={input} placeholder="voce@empresa.com" />
        </label>
      </div>
      <label style={campo}>
        <span style={rotulo}>Cidade</span>
        <input value={cidade} onChange={(e) => setCidade(e.target.value)} style={input} placeholder="Cidade — UF" />
      </label>
      <label style={campo}>
        <span style={rotulo}>Mensagem (opcional)</span>
        <textarea value={mensagem} onChange={(e) => setMensagem(e.target.value)} rows={3}
          style={{ ...input, height: "auto", padding: "10px 14px", resize: "vertical", fontFamily: "inherit" }}
          placeholder="Conte um pouco do seu catálogo" />
      </label>

      {erro && <p style={{ color: "#ffb4b4", fontSize: 13.5, margin: 0 }}>{erro}</p>}

      <button type="button" onClick={enviar} disabled={pending || !nome || !empresa}
        className="btn btn-onbrand btn-lg" style={{ opacity: pending ? 0.7 : 1, alignSelf: "flex-start" }}>
        {pending ? "Enviando..." : "Quero vender pela FrioHub"}
      </button>
    </div>
  );
}
