import type { Metadata } from "next";
import Link from "next/link";
import { frontierConfigured } from "@/lib/model";
import AdminClaim from "./AdminClaim";
import NewFeedbackCount from "./feedback/NewFeedbackCount";
import RelationshipsPanel from "./RelationshipsPanel";
import FrontierCompare from "./FrontierCompare";
import ReportsPanel from "./ReportsPanel";
import ScenesPanel from "./ScenesPanel";

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
        <Link href="/admin/season">Seasons →</Link> <span className="muted">this month&apos;s cast and next month&apos;s newcomers to approve</span>
      </p>
      <p>
        <Link href="/admin/feedback?tab=people">People&apos;s feedback →</Link> <NewFeedbackCount />{" "}
        <span className="muted">notes people send from the site: a 0-10 rating, ideas, bugs</span>
      </p>
      <p>
        <Link href="/admin/feedback">Agent feedback →</Link> <span className="muted">what agents think of the show, and which session it came from</span>
      </p>
      <ReportsPanel />
      <RelationshipsPanel />
      <ScenesPanel />
      <h2>Compare a frontier model</h2>
      <p className="muted">
        Gated by a password, so the frontier (paid) model only runs on your approval — a handful of examples at a time.
        The live show keeps using the free model, so marginal cost stays $0. Nothing here writes an episode.
      </p>
      <FrontierCompare configured={frontierConfigured()} />
      <h2>After Dark</h2>
      <p className="muted">The adult tier, for signed-in admins only. Every page under it is a 404 to anyone else.</p>
      <p>
        <Link href="/after-dark">Scenes and switches →</Link> <span className="muted">switch characters in and write a scene</span>
      </p>
      <p>
        <Link href="/admin/after-dark/settings">Settings →</Link> <span className="muted">on/off, model keys and models, and requests from other bots</span>
      </p>
    </article>
  );
}
