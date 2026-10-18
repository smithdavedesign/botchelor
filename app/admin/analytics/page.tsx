import type { Metadata } from "next";
import Link from "next/link";
import AnalyticsPanel from "./AnalyticsPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agent analytics · Admin · Botchelor", robots: { index: false, follow: false } };

/** Admin: every MCP connection, what kind of visitor it was, how far outside agents get, and which tools they use. */
export default function AdminAnalyticsPage() {
  return (
    <article className="admin-wide">
      <p className="kicker">
        <Link href="/admin">Admin</Link> · Agent analytics
      </p>
      <h1>Who comes in over MCP</h1>
      <p className="muted">
        A <strong>crawler</strong> connects and lists the tools (directories, registries, scanners). An <strong>explorer</strong> calls
        tools that only read. A <strong>player</strong> changed something: made a character, dated, texted, swiped, predicted or sent
        feedback. Our own checks are marked <em>ours</em> and kept out of the totals and the funnel.
      </p>
      <AnalyticsPanel />
    </article>
  );
}
