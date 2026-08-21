"use client";

import { useState } from "react";
import { AuthShell } from "../AuthShell";
import { SignupForm, type PapelCadastro } from "./SignupForm";

export function SignupShell({
  roleInicial,
  proximo,
  error,
  titulo,
  sub,
}: {
  roleInicial: PapelCadastro;
  proximo?: string;
  error?: string;
  titulo: Record<PapelCadastro, string>;
  sub: Record<PapelCadastro, string>;
}) {
  const [role, setRole] = useState(roleInicial);

  return (
    <AuthShell
      aba="signup"
      title={titulo[role]}
      subtitle={sub[role]}
      error={error}
      proximo={proximo}
      asideRole={role === "cliente" ? "cliente" : "profissional"}
    >
      <SignupForm role={role} onRoleChange={setRole} proximo={proximo} />
    </AuthShell>
  );
}
