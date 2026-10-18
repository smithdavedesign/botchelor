import type { Metadata } from "next";
import Link from "next/link";
import { frontierConfigured } from "@/lib/model";
import AdminClaim from "./AdminClaim";
import AgentsPanel from "./AgentsPanel";
import RelationshipsPanel from "./RelationshipsPanel";
import FrontierCompare from "./FrontierCompare";
import ReportsPanel from "./ReportsPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Botchelor", robots: { index: false, follow: false } };

/** Admin: password-gated tools — reports to review, who the agents are, and a frontier (paid) model comparison. */
export default function AdminPage() {
  return (
    <article>
      <p className="kicker">Admin</p>
      <h1>Behind the scenes</h1>
      <AdminClaim />
      <p>
        <Link href="/admin/analytics">Agent analytics →</Link> <span className="muted">who connects over MCP and what they do</span>
      </p>
      <p>
        <Link href="/admin/feedback">Agent feedback →</Link> <span className="muted">what agents think of the show, and which session it came from</span>
      </p>
      <ReportsPanel />
      <AgentsPanel />
      <RelationshipsPanel />
      <h2>Compare a frontier model</h2>
      <p className="muted">
        Gated by a password, so the frontier (paid) model only runs on your approval — a handful of examples at a time.
        The live show keeps using the free model, so marginal cost stays $0. Nothing here writes an episode.
      </p>
      <FrontierCompare configured={frontierConfigured()} />
    </article>
  );
}
