"use client";

import posthog from "posthog-js";

export const ANALYTICS_CONSENT_KEY = "friohub:analytics-consent:v1";
export const ANALYTICS_VERSION = "ux-2026-08";

type Role = "cliente" | "profissional" | "distribuidora" | "admin" | "anonimo";
type Events = {
  dashboard_action_opened: { role: Role; action_type: string; priority: string; source: "central"; experience_version: string };
  proposal_comparison_opened: { proposal_count: number; experience_version: string };
  proposal_comparison_decision: { proposal_count: number; quote_type: "preco_fechado" | "visita_tecnica"; result: "accepted"; experience_version: string };
  follow_up_completed: { outcome: string; overdue: boolean; experience_version: string };
  /* `ambientes` responde a pergunta que decide o roadmap: quantos clientes
     pedem mais de um cômodo de uma vez? Antes do pedido multi-ambiente isso era
     invisível — cada cômodo virava um pedido separado e indistinguível. */
  request_created: { job_type: string; target_count: number; reused_equipment: boolean; ambientes: number; experience_version: string };
  execution_draft_saved: { evidence_count: number; experience_version: string };
  execution_finalized: { experience_version: string };
  analytics_consent_updated: { granted: boolean };
};

export function analyticsConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN);
}

export function hasAnalyticsConsent() {
  return typeof window !== "undefined" && window.localStorage.getItem(ANALYTICS_CONSENT_KEY) === "granted";
}

export function captureAnalytics<E extends keyof Events>(event: E, properties: Events[E]) {
  if (!analyticsConfigured() || !hasAnalyticsConsent() || !posthog.has_opted_in_capturing()) return;
  posthog.capture(event, properties);
}

export function normalizeAnalyticsPath(pathname: string) {
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[id]")
    .replace(/\/[0-9]{4,}(?=\/|$)/g, "/[id]");
}
