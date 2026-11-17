import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { characterTypeDemand, DEMAND_DAYS, RAW_CAP, SHRINK, showRoleplayDemand } from "@/lib/tag-demand";
import { signedInAdmin } from "../signed-in-admin";
import DemandTable from "./DemandTable";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tags · Admin · Botchelor", robots: { index: false, follow: false } };

/**
 * Admin: what people on Botchelor pick, by tag (lib/tag-demand.ts, docs/tags.md "Demand"): the show's roleplays (dates
 * and companion scenes) and the character types people talk to, against what's on offer, beside the census's numbers
 * and the blend the pickers order by. After Dark's is its own page (app/admin/after-dark/tags).
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
  const db = await getDb();
  const [roleplays, types] = await Promise.all([showRoleplayDemand(db), characterTypeDemand(db)]);
  return (
    <article className="admin-wide">
      <p className="kicker">
        <Link href="/admin">Admin</Link> · Tags
      </p>
      <h1>What people pick, by tag</h1>
      <p className="muted">
        The last {DEMAND_DAYS} days, real people and agents only (our accounts and tests are left out). <strong>Ours</strong> is a tag&apos;s share of the
        picks over its share of what&apos;s on offer (1.00× is picked as often as it&apos;s offered), capped at {RAW_CAP}×. <strong>Blended</strong> leans on
        the census until a tag has picks of its own (it counts as {SHRINK} picks), and it&apos;s what the pickers order by.{" "}
        <Link href="/admin/after-dark/tags">After Dark&apos;s →</Link>
      </p>
      <h2>Roleplays on the show ({roleplays.total} picks)</h2>
      <DemandTable demand={roleplays} caption="Show dates and companion scenes" />
      <h2>Who people talk to ({types.total} conversations)</h2>
      <DemandTable demand={types} caption="Companion conversations by character type" />
    </article>
  );
}
