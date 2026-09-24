/* Importar como PRIMEIRA linha de cada index.ts (antes de qualquer outro
 * import) — é assim que o SDK do Deno consegue instrumentar `Deno.serve`
 * automaticamente e capturar exceção não tratada, sem precisar reescrever
 * cada handler por dentro.
 *
 * Não captura erro que a função já trata sozinha (os `console.error` +
 * `marcar_repasse_falho`/resposta 200 continuam do jeito que estão) — só
 * o que escapar sem tratamento, igual ao onRequestError do lado Next.js.
 */
import * as Sentry from "npm:@sentry/deno";

const dsn = Deno.env.get("SENTRY_DSN_EDGE");

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
  });
}

export { Sentry };
