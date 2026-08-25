"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Campo } from "@/components/ui";

const SENHA_MINIMA = 8;

const subtitulo: React.CSSProperties = { fontSize: 14.5, fontWeight: 650, color: "var(--ink-soft)" };

/* Senha e e-mail passam direto pelo Supabase Auth do navegador — sessão
 * autenticada já é a prova de identidade, sem RPC nem server action.
 * `updateUser` é uma operação self-service normal do próprio Supabase. */
export function ContaSeguranca({ emailAtual }: { emailAtual: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
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
      <span style={subtitulo}>Trocar senha</span>
      <Campo rotulo="Nova senha" type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)}
        erro={curta ? `Mínimo de ${SENHA_MINIMA} caracteres.` : null} />
      <Campo rotulo="Confirmar nova senha" type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)}
        erro={naoBate ? "As senhas não são iguais." : null} />
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
      <span style={subtitulo}>Trocar e-mail</span>
      <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>
        E-mail atual: <strong>{emailAtual}</strong>
      </p>
      <Campo rotulo="Novo e-mail" type="email" value={novoEmail} onChange={(e) => setNovoEmail(e.target.value)}
        placeholder="novo@email.com" erro={invalido ? "E-mail inválido." : null} />
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
