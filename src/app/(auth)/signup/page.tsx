import { AuthShell } from "../AuthShell";
import { SignupForm, type PapelCadastro } from "./SignupForm";
import { destinoSeguro } from "@/lib/proximo";

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  /* As landings mandam ?role= para o cadastro já abrir no papel certo:
     /parceiros → profissional, /distribuidoras → distribuidora. */
  const roleInicial: PapelCadastro =
    sp.role === "profissional" || sp.role === "distribuidora" ? sp.role : "cliente";

  const TITULO: Record<PapelCadastro, string> = {
    cliente: "Criar conta",
    profissional: "Criar conta de parceiro",
    distribuidora: "Criar conta de distribuidora",
  };
  const SUB: Record<PapelCadastro, string> = {
    cliente: "Leva menos de um minuto.",
    profissional: "Comece por aqui — o perfil técnico vem na sequência.",
    distribuidora: "Comece por aqui — o catálogo vem na sequência.",
  };

  const proximo = destinoSeguro(sp.next, "");

  return (
    <AuthShell
      aba="signup"
      title={TITULO[roleInicial]}
      subtitle={SUB[roleInicial]}
      error={error}
      proximo={proximo}
    >
      <SignupForm roleInicial={roleInicial} proximo={proximo} />
    </AuthShell>
  );
}
