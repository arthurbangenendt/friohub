import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Convenção do Next 16 (substitui o antigo "middleware"): roda no servidor
// antes de cada request. Usamos para manter a sessão do Supabase viva.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Roda em tudo, menos estáticos e imagens
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
