"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

const SENHA_MINIMA = 8;

const campo: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 7 };
const rotulo: React.CSSProperties = { fontSize: 13.5, fontWeight: 650, color: "var(--ink-soft)" };
const input: React.CSSProperties = { height: 44, padding: "0 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: 15, width: "100%" };

/* Senha e e-mail passam direto pelo Supabase Auth do navegador — sessão
 * autenticada já é a prova de identidade, sem RPC nem server action.
 * `updateUser` é uma operação self-service normal do próprio Supabase. */
export function ContaSeguranca({ emailAtual }: { emailAtual: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ fontSize: 12.5, fontWeight: 650, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)" }}>
        Conta e segurança
      </div>
      <TrocarSenha />
      <TrocarEmail emailAtual={emailAtual} />
    </div>
  );
}

function TrocarSenha() {
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  const curta = novaSenha.length > 0 && novaSenha.length < SENHA_MINIMA;
  const naoBate = confirmar.length > 0 && confirmar !== novaSenha;

  function salvar() {
    setErro(null);
    setSucesso(false);
    start(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: novaSenha });
      if (error) return setErro(error.message);
      setSucesso(true);
      setNovaSenha("");
      setConfirmar("");
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <span style={{ ...rotulo, fontSize: 14.5 }}>Trocar senha</span>
      <label style={campo}>
        <span style={rotulo}>Nova senha</span>
        <input type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} style={input} />
        {curta && <span style={{ fontSize: 12.5, color: "var(--danger)" }}>Mínimo de {SENHA_MINIMA} caracteres.</span>}
      </label>
      <label style={campo}>
        <span style={rotulo}>Confirmar nova senha</span>
        <input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} style={input} />
        {naoBate && <span style={{ fontSize: 12.5, color: "var(--danger)" }}>As senhas não são iguais.</span>}
      </label>
      {erro && <p style={{ color: "var(--danger)", fontSize: 14, margin: 0 }}>{erro}</p>}
      {sucesso && <p style={{ color: "var(--good)", fontSize: 14, fontWeight: 600, margin: 0 }}>Senha atualizada!</p>}
      <button className="btn btn-primary" onClick={salvar}
        disabled={pending || novaSenha.length < SENHA_MINIMA || novaSenha !== confirmar}
        style={{ alignSelf: "flex-start", opacity: pending ? 0.7 : 1 }}>
        {pending ? "Salvando..." : "Trocar senha"}
      </button>
    </div>
  );
}

function TrocarEmail({ emailAtual }: { emailAtual: string }) {
  const [novoEmail, setNovoEmail] = useState("");
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  const invalido = novoEmail.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(novoEmail);

  function salvar() {
    setErro(null);
    setSucesso(false);
    start(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ email: novoEmail });
      if (error) return setErro(error.message);
      setSucesso(true);
      setNovoEmail("");
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <span style={{ ...rotulo, fontSize: 14.5 }}>Trocar e-mail</span>
      <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>
        E-mail atual: <strong>{emailAtual}</strong>
      </p>
      <label style={campo}>
        <span style={rotulo}>Novo e-mail</span>
        <input type="email" value={novoEmail} onChange={(e) => setNovoEmail(e.target.value)} style={input} placeholder="novo@email.com" />
        {invalido && <span style={{ fontSize: 12.5, color: "var(--danger)" }}>E-mail inválido.</span>}
      </label>
      {erro && <p style={{ color: "var(--danger)", fontSize: 14, margin: 0 }}>{erro}</p>}
      {sucesso && (
        <p style={{ color: "var(--good)", fontSize: 14, fontWeight: 600, margin: 0 }}>
          Enviamos um link de confirmação para o seu e-mail atual e para o novo endereço.
          A troca só é concluída depois que os dois forem confirmados.
        </p>
      )}
      <button className="btn btn-primary" onClick={salvar}
        disabled={pending || !novoEmail || invalido}
        style={{ alignSelf: "flex-start", opacity: pending ? 0.7 : 1 }}>
        {pending ? "Enviando..." : "Trocar e-mail"}
      </button>
    </div>
  );
}
