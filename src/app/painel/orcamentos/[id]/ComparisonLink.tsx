"use client";
import Link from "next/link";
import { ANALYTICS_VERSION, captureAnalytics } from "@/lib/analytics";
export function ComparisonLink({ href, count }: { href: string; count: number }) { return <Link href={href} onClick={() => captureAnalytics("proposal_comparison_opened", { proposal_count: count, experience_version: ANALYTICS_VERSION })} className="btn" style={{ height: 38, fontSize: 13 }}>Comparar lado a lado</Link>; }
