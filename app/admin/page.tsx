import type { Metadata } from "next";
import Link from "next/link";
import { afterDarkHref } from "@/lib/after-dark-host";
import { frontierConfigured } from "@/lib/model";
import AdminClaim from "./AdminClaim";
import AdminGate from "./AdminGate";
import NewFeedbackCount from "./feedback/NewFeedbackCount";
import RelationshipsPanel from "./RelationshipsPanel";
import FrontierCompare from "./FrontierCompare";
import KeysPanel from "./KeysPanel";
import ReportsPanel from "./ReportsPanel";
import ScenesPanel from "./ScenesPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Botchelor", robots: { index: false, follow: false } };

/** Admin: password-gated tools — reports to review, who the agents are, and a frontier (paid) model comparison. */
export default function AdminPage() {
  const tiles = [
    { href: "/admin/analytics", label: "Analytics", note: "people, agents and quality: trends, the funnel, top characters, and who connects over MCP" },
    { href: "/admin/season", label: "Seasons", note: "this month's cast and next month's newcomers to approve" },
    { href: "/admin/feedback?tab=people", label: "People's feedback", note: "notes people send from the site: a 0-10 rating, ideas, bugs", count: true },
    { href: "/admin/feedback", label: "Agent feedback", note: "what agents think of the show, and which session it came from" },
  ];
  const afterDark = [
    { href: afterDarkHref("/after-dark"), label: "Scenes and switches", note: "switch characters in and write a scene" },
    { href: afterDarkHref("/admin/after-dark/graph"), label: "Graph", note: "every character's After Dark content on one page: who with whom, scenes, nights, videos and pictures" },
    { href: afterDarkHref("/admin/after-dark/settings"), label: "Settings", note: "on/off, model keys and models, and requests from other bots" },
    { href: afterDarkHref("/admin/after-dark/providers"), label: "Providers", note: "each house provider's key and live status: Hive's daily limit, Venice and Replicate cooling down" },
  ];
  return (
    <article>
      <p className="kicker">Admin</p>
      <h1>Behind the scenes</h1>
      <AdminGate areas={tiles.map(({ href, label }) => ({ href, label }))}>
        <ul className="admin-tiles">
          {tiles.map((t) => (
            <li key={t.href}>
              <Link href={t.href} className="admin-tile">
                <strong>
                  {t.label} →
                </strong>
                {t.count && (
                  <span className="admin-tile-count">
                    <NewFeedbackCount />
                  </span>
                )}
                <span className="muted small">{t.note}</span>
              </Link>
            </li>
          ))}
        </ul>
        <AdminClaim />
        <ReportsPanel />
        <RelationshipsPanel />
        <ScenesPanel />
        <KeysPanel />
        <h2>Compare a frontier model</h2>
        <p className="muted">
          Gated by a password, so the frontier (paid) model only runs on your approval — a handful of examples at a time.
          The live show keeps using the free model, so marginal cost stays $0. Nothing here writes an episode.
        </p>
        <FrontierCompare configured={frontierConfigured()} />
        <h2>After Dark</h2>
        <p className="muted">The adult tier, for signed-in admins only. Every page under it is a 404 to anyone else.</p>
        <ul className="admin-tiles">
          {afterDark.map((t) => (
            <li key={t.label}>
              <Link href={t.href} className="admin-tile">
                <strong>{t.label} →</strong>
                <span className="muted small">{t.note}</span>
              </Link>
            </li>
          ))}
        </ul>
      </AdminGate>
    </article>
  );
}
