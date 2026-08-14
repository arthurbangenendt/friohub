import { SkeletonFormulario } from "@/components/ui";

/* O perfil é formulário, não lista — o esqueleto padrão do painel (KPIs + linhas)
   deixaria o layout pular quando os dados chegassem. */
export default function Loading() {
  return <SkeletonFormulario campos={6} />;
}
