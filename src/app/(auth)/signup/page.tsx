import { AuthShell } from "../AuthShell";
import { SignupForm } from "./SignupForm";

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  // A landing /parceiros manda ?role=profissional para o cadastro já abrir no papel certo.
  const roleInicial = sp.role === "profissional" ? "profissional" : "cliente";

  return (
    <AuthShell
      aba="signup"
      title={roleInicial === "profissional" ? "Criar conta de parceiro" : "Criar conta"}
      subtitle={roleInicial === "profissional"
        ? "Comece por aqui — o perfil técnico vem na sequência."
        : "Leva menos de um minuto."}
      error={error}
    >
      <SignupForm roleInicial={roleInicial} />
    </AuthShell>
  );
}
