import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import InsightsDashboard from "./InsightsDashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Analytics · Admin · Botchelor", robots: { index: false, follow: false } };

/**
 * Admin: the insights overview (lib/insights.ts: what stands out, the key numbers against the previous period, the
 * people funnel), then Product (what gets made, the top characters and venues, retention, Real use), Agents (every MCP
 * connection, lib/agent-analytics.ts) and Quality (the golden set, the observer, the visitor loop). docs/analytics.md
 * says what each chart means and where its numbers come from.
 */
export default function AdminAnalyticsPage() {
  return (
    <article className="admin-wide">
      <p className="kicker">
        <Link href="/admin">Admin</Link> · Analytics
      </p>
      <h1>How the show is doing</h1>
      <p className="muted">
        Real people and real agents, from the database, with our own traffic left out unless you ask for it. One row of filters scopes
        every tab and stays in the address, so a link opens the same view. <strong>People</strong> and <strong>Agents</strong> split by
        who did it (on the web or over MCP); <strong>House</strong> is everything with a house character in it.{" "}
        <strong>Engagement</strong> is every page view and click from the site&apos;s own beacon (since 2026-10-31; Who doesn&apos;t
        apply there). No money is shown here.
      </p>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <InsightsDashboard />
      </Suspense>
    </article>
  );
}
