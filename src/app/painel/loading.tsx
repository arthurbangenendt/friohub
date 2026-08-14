import { SkeletonPainel } from "@/components/ui";

/* Vale para todas as rotas de `/painel` que não declararem um `loading.tsx`
   próprio. Sem ele, o Next mantinha a tela anterior enquanto as 5 a 7 consultas
   Supabase da página resolviam — no 4G do celular do técnico isso lê como
   aplicativo travado, não como aplicativo carregando. */
export default function Loading() {
  return <SkeletonPainel />;
}
