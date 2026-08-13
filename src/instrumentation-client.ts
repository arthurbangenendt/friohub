import posthog from "posthog-js";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

if (token) {
  posthog.init(token, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    defaults: "2026-05-30",
    autocapture: false,
    advanced_disable_flags: true,
    capture_pageview: false,
    capture_pageleave: false,
    capture_performance: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
    disable_surveys: true,
    disable_session_recording: true,
    opt_out_capturing_by_default: true,
    persistence: "localStorage",
    person_profiles: "identified_only",
    respect_dnt: true,
  });
}
