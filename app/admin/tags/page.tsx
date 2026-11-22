import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { adminTagDemand, DEMAND_DAYS, FEW_PICKS, RAW_CAP, SHRINK } from "@/lib/tag-demand";
import { signedInAdmin } from "../signed-in-admin";
import DemandTable from "./DemandTable";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tags · Admin · Botchelor", robots: { index: false, follow: false } };

/**
 * Admin: what people on Botchelor pick, by tag (lib/tag-demand.ts, docs/tags.md "Demand"): the show's roleplays (dates
 * and companion scenes) and the character types people talk to, against what's on offer, beside the census's numbers
 * and the blend the pickers order by. After Dark's is its own page (app/admin/after-dark/tags). Below them, two facets
 * that aren't tags (docs/PRDs/styles-and-storylines.md phase 7): how people want their characters drawn, and who they
 * look for, each with where the picks came from.
 */
export default async function AdminTagsPage() {
  if (!(await signedInAdmin())) {
    return (
      <article className="admin-wide">
        <h1>Tags</h1>
        <p className="muted">Sign in to an admin account to see this.</p>
      </article>
    );
  }
  // Kept ten minutes (lib/tag-demand.ts adminTagDemand): 90 days of picks took about 4 s to read on every load.
  const { roleplays, types, styles, lineup, at } = await adminTagDemand(await getDb());
  return (
    <article className="admin-wide">
      <p className="kicker">
        <Link href="/admin">Admin</Link> · Tags
      </p>
      <h1>What people pick, by tag</h1>
      <p className="muted">
        The last {DEMAND_DAYS} days, real people and agents only (our accounts and tests are left out). <strong>Ours</strong> is a tag&apos;s share of the
        picks over its share of what&apos;s on offer (1.00× is picked as often as it&apos;s offered), shown raw; the blend caps it at {RAW_CAP}× first.
        Rows under {FEW_PICKS} picks are greyed: too few to mean much. <strong>Blended</strong> leans on the census until a tag has picks of its own
        (it counts as {SHRINK} picks), and it&apos;s what the pickers order by. Read at{" "}
        {new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC, kept ten minutes.{" "}
        <Link href="/admin/after-dark/tags">After Dark&apos;s →</Link>
      </p>
      <h2>Roleplays on the show ({roleplays.total} picks)</h2>
      <DemandTable demand={roleplays} caption="Show dates and companion scenes" />
      <h2>Who people talk to ({types.total} conversations)</h2>
      <DemandTable demand={types} caption="Companion conversations by character type" />
      <h2>How they&apos;re drawn ({styles.total} picks)</h2>
      <p className="muted">
        Characters made in each style on Create, the style filter on Companions and Characters, and conversations started with a character drawn that
        way, against the characters anyone may find. The census rank by art style is the prior.
      </p>
      <DemandTable
        demand={styles}
        caption="Art style"
        item="Style"
        sources={{ by: styles.sources, labels: { made: "Made", filtered: "Filter", chats: "Chats" } }}
      />
      <h2>Who people look for ({lineup.total} picks)</h2>
      <p className="muted">The pronouns filter on Companions and conversations started, by the pronouns of who they&apos;re with. The prior is even.</p>
      <DemandTable demand={lineup} caption="Lineup" item="Pronouns" sources={{ by: lineup.sources, labels: { filtered: "Filter", chats: "Chats" } }} />
    </article>
  );
}
