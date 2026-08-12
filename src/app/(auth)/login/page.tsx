import { login } from "../actions";
import { AuthShell } from "../AuthShell";
import { Field, primaryBtn } from "../ui";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const aviso = typeof sp.aviso === "string" ? sp.aviso : undefined;

  return (
    <AuthShell
      aba="login"
      title="Entrar"
      subtitle="Acesse sua conta FrioHub."
      error={error}
      aviso={aviso}
    >
      <form action={login}>
        <Field label="Email" name="email" type="email" autoComplete="email" placeholder="voce@email.com" />
        <Field label="Senha" name="password" type="password" autoComplete="current-password" placeholder="••••••••" />
        <button type="submit" style={primaryBtn}>Entrar</button>
      </form>
    </AuthShell>
  );
}
