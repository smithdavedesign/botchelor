import type { Metadata } from "next";
import Link from "next/link";
import { adultRoleplayDemand } from "@/lib/adult/tag-demand";
import { getDb } from "@/lib/db";
import { DEMAND_DAYS } from "@/lib/tag-demand";
import DemandTable from "@/app/admin/tags/DemandTable";
import { signedInAdmin } from "@/app/admin/signed-in-admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "After Dark tags · Admin · Botchelor", robots: { index: false, follow: false } };

/**
 * Admin: what members pick in After Dark, by tag (lib/adult/tag-demand.ts): Set the scene and Step in roleplays, by
 * setup, theme and heat, against the house roleplays on offer and the census's adult column.
 */
export default async function AdminAfterDarkTagsPage() {
  if (!(await signedInAdmin())) {
    return (
      <article className="admin-wide">
        <h1>After Dark tags</h1>
        <p className="muted">Sign in to an admin account to see this.</p>
      </article>
    );
  }
  const demand = await adultRoleplayDemand(await getDb());
  return (
    <article className="admin-wide">
      <p className="kicker">
        <Link href="/admin/tags">Tags</Link> · After Dark
      </p>
      <h1>What members pick in After Dark</h1>
      <p className="muted">
        Set the scene and Step in, the last {DEMAND_DAYS} days, real members only. {demand.total} picks.
      </p>
      <DemandTable demand={demand} caption="After Dark roleplays" />
    </article>
  );
}
