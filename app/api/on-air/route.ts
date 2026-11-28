import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { nextPremiere } from "@/lib/sunday-premiere";

export const dynamic = "force-dynamic";

/**
 * The next Sunday premiere in a few fields, for the site-wide on-air bar (app/motion/OnAirBar.tsx, 2026-11-28): while
 * it's live, the red "Live now" bar; the rest of the week, the countdown chip. Public, the same for everyone, and kept a
 * minute at the edge, so a page's bar costs no database read of its own. `premiere` is null with no lead season ahead.
 */
export const GET = handle(async () => {
  const p = await nextPremiere(await getDb()).catch(() => null);
  const premiere = p
    ? { at: p.at, state: p.state, kind: p.kind, finale: p.finale, lead: p.lead.name.split(/\s+/)[0], suitor: p.suitor ? p.suitor.name.split(/\s+/)[0] : null, room_path: p.room_path }
    : null;
  const res = json({ premiere });
  res.headers.set("cache-control", "public, max-age=30, s-maxage=60, stale-while-revalidate=300");
  return res;
});
