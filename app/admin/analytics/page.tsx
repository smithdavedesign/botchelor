import type { Metadata } from "next";
import Link from "next/link";
import AnalyticsPanel from "./AnalyticsPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Analytics · Admin · Botchelor", robots: { index: false, follow: false } };

/**
 * Admin: real use (people and agents, last 7 and 30 days, next to the simulated visitors' ratings: lib/real-metrics.ts),
 * then every MCP connection, what kind of visitor it was, how far outside agents get, and which tools they use.
 */
export default function AdminAnalyticsPage() {
  return (
    <article className="admin-wide">
      <p className="kicker">
        <Link href="/admin">Admin</Link> · Analytics
      </p>
      <h1>Real use, and who comes in over MCP</h1>
      <p className="muted">
        <strong>Real use</strong> is what real people and real agents did, with our own traffic left out, next to the simulated
        visitors&apos; ratings: the product is judged by both. Below it, every MCP connection: a <strong>crawler</strong> connects and
        lists the tools (directories, registries, scanners). An <strong>explorer</strong> calls tools that only read. A{" "}
        <strong>player</strong> changed something: made a character, dated, texted, swiped, predicted or sent feedback. Our own checks
        are marked <em>ours</em> and kept out of the totals and the funnel.
      </p>
      <AnalyticsPanel />
    </article>
  );
}
