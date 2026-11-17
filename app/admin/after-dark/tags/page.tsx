import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { signedInAdmin } from "@/lib/adult/mode";
import { lockedForCookies } from "@/lib/adult/privacy";
import { adultRoleplayDemand } from "@/lib/adult/tag-demand";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { DEMAND_DAYS } from "@/lib/tag-demand";
import DemandTable from "@/app/admin/tags/DemandTable";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "After Dark tags · Botchelor", robots: { index: false, follow: false } };

/**
 * Admin: what members pick in After Dark, by tag (lib/adult/tag-demand.ts): Set the scene and Step in roleplays, by
 * setup, theme and heat, against the house roleplays on offer and the census's adult column. Signed-in admins only, a
 * 404 to everyone else, like After Dark's other admin pages; numbers only, no one's scenes.
 */
export default async function AdminAfterDarkTagsPage() {
  const db = await getDb();
  const store = await cookies();
  const admin = await signedInAdmin(db, authFromCookieStore(store));
  // A device that hasn't entered the admin's PIN (lib/adult/privacy.ts) gets nothing: the layout asks for it instead.
  if (!admin || (await lockedForCookies(db, admin, store))) notFound();
  const demand = await adultRoleplayDemand(db);
  return (
    <article className="admin-wide">
      <p className="kicker">
        <Link href="/admin/tags">← Tags</Link> · <Link href="/after-dark">After Dark</Link>
      </p>
      <h1>What members pick in After Dark</h1>
      <p className="muted">
        Set the scene and Step in, the last {DEMAND_DAYS} days, real members only: {demand.total} picks.
      </p>
      <DemandTable demand={demand} caption="After Dark roleplays" />
    </article>
  );
}
