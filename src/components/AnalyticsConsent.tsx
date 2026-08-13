"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import posthog from "posthog-js";
import { ANALYTICS_CONSENT_KEY, analyticsConfigured, captureAnalytics, hasAnalyticsConsent, normalizeAnalyticsPath } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";

type Choice = "granted" | "denied" | null;

export function AnalyticsConsent() {
  const pathname = usePathname();
  const [choice, setChoice] = useState<Choice>(null);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!analyticsConfigured()) return;
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
      const next = stored === "granted" || stored === "denied" ? stored : null;
      setChoice(next);
      if (next === "granted") posthog.opt_in_capturing();
      else posthog.opt_out_capturing();
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!analyticsConfigured() || !hasAnalyticsConsent()) return;
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) posthog.identify(data.user.id);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") posthog.reset();
      else if (session?.user) posthog.identify(session.user.id);
    });
    return () => listener.subscription.unsubscribe();
  }, [choice]);

  useEffect(() => {
    if (choice !== "granted" || !pathname) return;
    const path = normalizeAnalyticsPath(pathname);
    posthog.capture("$pageview", { $current_url: `${window.location.origin}${path}`, route_pattern: path });
  }, [choice, pathname]);

  function decide(granted: boolean) {
    const next: Choice = granted ? "granted" : "denied";
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, next);
    if (granted) {
      posthog.opt_in_capturing();
      setChoice(next);
      setEditing(false);
      captureAnalytics("analytics_consent_updated", { granted: true });
    } else {
      if (posthog.has_opted_in_capturing()) captureAnalytics("analytics_consent_updated", { granted: false });
      posthog.opt_out_capturing();
      posthog.reset();
      setChoice(next);
      setEditing(false);
    }
  }

  if (!analyticsConfigured() || !ready) return null;
  if (choice !== null && !editing) return <button type="button" onClick={() => setEditing(true)} aria-label="Alterar preferência de analytics" style={{ position: "fixed", zIndex: 900, right: 12, bottom: 12, border: "1px solid var(--line)", borderRadius: 99, background: "var(--surface)", color: "var(--ink-soft)", padding: "7px 10px", font: "inherit", fontSize: 11.5, cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,.1)" }}>Analytics: {choice === "granted" ? "ativado" : "desativado"}</button>;
  return <aside aria-label="Preferências de analytics" style={{ position: "fixed", zIndex: 1000, left: 16, right: 16, bottom: 16, maxWidth: 720, margin: "0 auto", padding: 18, borderRadius: 14, background: "var(--ink)", color: "var(--surface)", boxShadow: "0 12px 40px rgba(0,0,0,.28)" }}>
    <strong>Ajude a melhorar o FrioHub</strong>
    <p style={{ margin: "6px 0 14px", fontSize: 13.5, lineHeight: 1.5, opacity: .9 }}>Com sua permissão, medimos quais telas e ações ajudam de verdade. Não enviamos mensagens, endereços, telefone, fotos ou valores financeiros. Você pode mudar de ideia depois. <Link href="/privacidade" style={{ color: "inherit", textDecoration: "underline" }}>Saiba mais</Link>.</p>
    <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}><button type="button" className="btn btn-primary" onClick={() => decide(true)}>Aceitar analytics</button><button type="button" className="btn" onClick={() => decide(false)}>Continuar sem analytics</button></div>
  </aside>;
}
