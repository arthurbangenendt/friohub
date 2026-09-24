import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  org: "friohub",
  project: "javascript-nextjs",
  silent: true,
  // Sem SENTRY_AUTH_TOKEN configurado ainda, o plugin não tenta subir
  // source maps — só passa a fazer isso quando o token for adicionado
  // (ver conversa: criar junto, mesmo padrão do DSN).
  widenClientFileUpload: true,
});
