import type { Metadata } from "next";
import Link from "next/link";
import { afterDarkHref } from "@/lib/after-dark-host";
import { frontierConfigured } from "@/lib/model";
import AdminClaim from "./AdminClaim";
import { signedInAdmin } from "./signed-in-admin";
import AdminGate from "./AdminGate";
import NewFeedbackCount from "./feedback/NewFeedbackCount";
import RelationshipsPanel from "./RelationshipsPanel";
import FrontierCompare from "./FrontierCompare";
import KeysPanel from "./KeysPanel";
import ReportsPanel from "./ReportsPanel";
import ScenesPanel from "./ScenesPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Botchelor", robots: { index: false, follow: false } };

/** Admin: tools for a signed-in admin account — reports to review, who the agents are, and a frontier (paid) model comparison. */
export default async function AdminPage() {
  const admin = await signedInAdmin();
  const tiles = [
    { href: "/admin/reports", label: "Complaints and takedowns", note: "reports from /report: a minor, a real person, an intimate image (48 hours), copyright and the rest (7 business days)" },
    { href: "/admin/analytics", label: "Analytics", note: "people, agents and quality: trends, the funnel, top characters, and who connects over MCP" },
    { href: "/admin/spend", label: "Spend", note: "money in and out: API and infrastructure costs, income, and each provider's live balance" },
    { href: "/admin/tags", label: "Tags", note: "what people pick by tag (roleplays, character types; After Dark's too) against the census, and what the pickers order by" },
    { href: "/admin/social", label: "Social network", note: "the network day by day, the most central characters, what a dataset could license, and how often Might know lands" },
    { href: "/admin/season", label: "Seasons", note: "this month's cast and next month's newcomers to approve" },
    // Creators whose post is held are told it's "held for a look in /admin/showcase" (lib/showcase-moderation.ts).
    { href: "/admin/showcase", label: "Gallery posts held for a look", note: "showcase posts the checks held back: approve or remove" },
    { href: "/admin/live-face", label: "Live face renderers", note: "one line, every lip-sync renderer side by side, rated; and which one your own calls use" },
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
      <AdminGate admin={admin} areas={tiles.map(({ href, label }) => ({ href, label }))}>
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
