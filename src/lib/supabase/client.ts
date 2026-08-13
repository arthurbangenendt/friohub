import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database.generated";

// Cliente Supabase para uso no navegador (componentes "use client").
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
