import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Artefatos locais gerados pelo Supabase CLI (Edge Runtime, secrets etc.).
    "supabase/.temp/**",
    // Edge Functions são Deno, não Next: global `Deno`, imports `jsr:` e
    // extensão `.ts` explícita. Quem as valida é `supabase functions deploy`.
    "supabase/functions/**",
  ]),
]);

export default eslintConfig;
