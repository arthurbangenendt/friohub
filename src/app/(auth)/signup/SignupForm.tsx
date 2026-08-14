"use client";

import { useState } from "react";
import Link from "next/link";
import { signup } from "../actions";
import { labelStyle, input, primaryBtn, fieldWrap } from "../ui";
import { formatarDocumento, formatarTelefone, validarDocumento, validarTelefone, tipoDocumento } from "@/lib/documento";

const SENHA_MINIMA = 8;

/* Validação em duas frentes: aqui, para o feedback ser imediato enquanto a
   pessoa digita; e de novo no server action, porque nada impede um POST direto.
   Ver validação equivalente em (auth)/actions.ts. */
export type PapelCadastro = "cliente" | "profissional" | "distribuidora";

export function SignupForm({ roleInicial, proximo }: { roleInicial: PapelCadastro; proximo?: string }) {
  const [role, setRole] = useState(roleInicial);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [documento, setDocumento] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [aceite, setAceite] = useState(false);
  const [tocado, setTocado] = useState<Record<string, boolean>>({});

  const marcar = (campo: string) => setTocado((t) => ({ ...t, [campo]: true }));

  const docTipo = tipoDocumento(documento);
  const erroDoc = tocado.documento && documento && !validarDocumento(documento)
    ? (docTipo === null ? "Informe 11 dígitos (CPF) ou 14 (CNPJ)." : `${docTipo.toUpperCase()} inválido.`)
    : null;
  const erroTel = tocado.telefone && telefone && !validarTelefone(telefone) ? "Telefone incompleto." : null;
  const erroSenha = tocado.senha && senha && senha.length < SENHA_MINIMA ? `Mínimo de ${SENHA_MINIMA} caracteres.` : null;
  const erroConf = tocado.confirmar && confirmar && senha !== confirmar ? "As senhas não conferem." : null;

  const podeEnviar =
    nome.trim().length >= 3 && validarTelefone(telefone) && validarDocumento(documento) &&
    senha.length >= SENHA_MINIMA && senha === confirmar && aceite;

  return (
    <form action={signup}>
      <input type="hidden" name="role" value={role} />
      {/* Só vale para o papel cliente; ver a regra no server action. */}
      {proximo ? <input type="hidden" name="next" value={proximo} /> : null}

      <div style={{ marginBottom: 18 }}>
        <span style={{ ...labelStyle, display: "block", marginBottom: 8 }}>Eu sou</span>
        {/* Três lados do marketplace, três papéis. A distribuidora entrou aqui
            junto com o módulo dela — antes o cadastro dela virava cliente em
            silêncio, porque o papel nem existia no allowlist. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <RoleOption ativo={role === "cliente"} onClick={() => setRole("cliente")}
            titulo="Cliente" desc="Quero instalar, limpar ou consertar" />
          <RoleOption ativo={role === "profissional"} onClick={() => setRole("profissional")}
            titulo="Profissional" desc="Instalo / faço manutenção" />
          <RoleOption ativo={role === "distribuidora"} onClick={() => setRole("distribuidora")}
            titulo="Distribuidora" desc="Vendo equipamentos" />
        </div>
      </div>

      <Campo label="Nome completo" erro={tocado.nome && nome && nome.trim().length < 3 ? "Informe seu nome completo." : null}>
        <input name="nome" value={nome} onChange={(e) => setNome(e.target.value)} onBlur={() => marcar("nome")}
          autoComplete="name" placeholder="Seu nome" required style={input} />
      </Campo>

      <Campo label="Email">
        <input name="email" type="email" autoComplete="email" placeholder="voce@email.com" required style={input} />
      </Campo>

      <Campo label="Telefone / WhatsApp" erro={erroTel}>
        <input name="telefone" value={telefone} onChange={(e) => setTelefone(formatarTelefone(e.target.value))}
          onBlur={() => marcar("telefone")} inputMode="numeric" autoComplete="tel"
          placeholder="(11) 90000-0000" required style={input} />
      </Campo>

      <Campo label="CPF ou CNPJ" erro={erroDoc}
        dica={role === "distribuidora" ? "Informe o CNPJ da distribuidora."
          : role === "profissional" ? "Empresa: informe o CNPJ. Autônomo: CPF." : undefined}>
        <input name="documento" value={documento} onChange={(e) => setDocumento(formatarDocumento(e.target.value))}
          onBlur={() => marcar("documento")} inputMode="numeric"
          placeholder="000.000.000-00" required style={input} />
      </Campo>

      <Campo label="Senha" erro={erroSenha}>
        <input name="password" type="password" value={senha} onChange={(e) => setSenha(e.target.value)}
          onBlur={() => marcar("senha")} autoComplete="new-password"
          placeholder={`mínimo ${SENHA_MINIMA} caracteres`} required style={input} />
      </Campo>

      <Campo label="Confirmar senha" erro={erroConf}>
        <input name="confirmar" type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)}
          onBlur={() => marcar("confirmar")} autoComplete="new-password" placeholder="repita a senha" required style={input} />
      </Campo>

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "6px 0 18px", cursor: "pointer" }}>
        <input type="checkbox" name="aceite" checked={aceite} onChange={(e) => setAceite(e.target.checked)}
          style={{ width: 18, height: 18, accentColor: "var(--cool)", marginTop: 1, flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5 }}>
          Li e aceito os{" "}
          <Link href="/termos" target="_blank" style={{ color: "var(--cool-deep)", fontWeight: 600 }}>Termos de Uso</Link>{" "}
          e a{" "}
          <Link href="/privacidade" target="_blank" style={{ color: "var(--cool-deep)", fontWeight: 600 }}>Política de Privacidade</Link>.
        </span>
      </label>

      <button type="submit" style={{ ...primaryBtn, opacity: podeEnviar ? 1 : 0.55, cursor: podeEnviar ? "pointer" : "not-allowed" }}
        disabled={!podeEnviar}>
        Criar conta
      </button>

      {role === "profissional" && (
        <p style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 12, textAlign: "center" }}>
          Depois de criar a conta você completa seu perfil profissional: especialidades,
          equipamentos que domina e região de atendimento.
        </p>
      )}
    </form>
  );
}

function Campo({ label, erro, dica, children }: { label: string; erro?: string | null; dica?: string; children: React.ReactNode }) {
  return (
    <label style={fieldWrap}>
      <span style={labelStyle}>{label}</span>
      {children}
      {dica && !erro && <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>{dica}</span>}
      {erro && <span style={{ fontSize: 12, color: "var(--danger)" }}>{erro}</span>}
    </label>
  );
}

function RoleOption({ ativo, onClick, titulo, desc }: { ativo: boolean; onClick: () => void; titulo: string; desc: string }) {
  return (
    <button type="button" onClick={onClick} style={{
      textAlign: "left", padding: "12px 14px", borderRadius: 12, cursor: "pointer",
      border: `1px solid ${ativo ? "var(--cool)" : "var(--line)"}`,
      background: ativo ? "var(--cool-wash)" : "var(--bg)",
      boxShadow: ativo ? "inset 0 0 0 1px var(--cool)" : "none",
    }}>
      <span style={{ display: "block", fontWeight: 650, fontSize: 14, color: "var(--ink)" }}>{titulo}</span>
      <span style={{ display: "block", fontSize: 12, color: "var(--ink-faint)", marginTop: 2 }}>{desc}</span>
    </button>
  );
}
