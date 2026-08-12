import Link from "next/link";
import { signup } from "../actions";
import { AuthShell } from "../AuthShell";
import { Field, primaryBtn, labelStyle } from "../ui";

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  return (
    <AuthShell
      title="Criar conta"
      subtitle="Leva menos de um minuto."
      error={error}
      footer={
        <>
          Já tem conta?{" "}
          <Link href="/login" style={{ color: "var(--cool-deep)", fontWeight: 600 }}>
            Entrar
          </Link>
        </>
      }
    >
      <form action={signup}>
        <div style={{ marginBottom: 18 }}>
          <span style={{ ...labelStyle, display: "block", marginBottom: 8 }}>Eu sou</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <RoleOption value="cliente" titulo="Cliente" desc="Quero instalar ou dar manutenção" defaultChecked />
            <RoleOption value="profissional" titulo="Profissional" desc="Instalo / faço manutenção" />
          </div>
        </div>

        <Field label="Nome" name="nome" autoComplete="name" placeholder="Seu nome" />
        <Field label="Email" name="email" type="email" autoComplete="email" placeholder="voce@email.com" />
        <Field label="Senha" name="password" type="password" autoComplete="new-password" placeholder="mínimo 6 caracteres" />
        <button type="submit" style={primaryBtn}>Criar conta</button>
      </form>
    </AuthShell>
  );
}

function RoleOption({
  value,
  titulo,
  desc,
  defaultChecked,
}: {
  value: string;
  titulo: string;
  desc: string;
  defaultChecked?: boolean;
}) {
  return (
    <label style={{ position: "relative", cursor: "pointer" }}>
      <input
        type="radio"
        name="role"
        value={value}
        defaultChecked={defaultChecked}
        style={{ position: "absolute", opacity: 0, inset: 0, cursor: "pointer" }}
        className="role-radio"
      />
      <span
        style={{
          display: "block",
          padding: "12px 14px",
          borderRadius: 12,
          border: "1px solid var(--line)",
          background: "var(--bg)",
        }}
        className="role-card"
      >
        <span style={{ display: "block", fontWeight: 650, fontSize: 14 }}>{titulo}</span>
        <span style={{ display: "block", fontSize: 12, color: "var(--ink-faint)", marginTop: 2 }}>{desc}</span>
      </span>
    </label>
  );
}
