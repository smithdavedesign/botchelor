/**
 * Books both tables of a double date (lib/group-dates.ts) through the same route as go_on_date — the proposer's
 * couple as the proposer, the other couple as its own booker — so caps, consent and every booking rule apply per
 * booker. Kept out of lib/group-dates.ts because this imports the route, and the route imports that module.
 *
 * Half a night: if the proposer's table can't book (their budget, a block), nothing books and the night lapses.
 * If theirs books and the other side's doesn't, the booked date goes ahead solo (its group_id is cleared) and both
 * hear why — a spent date is a real date, never thrown away.
 */
import { POST as postEpisode } from "@/app/api/episodes/route";
import type { Db } from "./db";
import { type GroupNight } from "./group-dates";
import { MCP_CALL_URL, USER_COOKIE } from "./http";
import { notify } from "./notifications";

async function book(asUserId: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const req = new Request(MCP_CALL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${USER_COOKIE}=${asUserId}` },
    body: JSON.stringify(body),
  });
  const res = await postEpisode(req);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

export type NightResult =
  | { ok: true; episode_a: string; episode_b: string }
  | { ok: false; error: string; episode_a?: string };

/** Books a night whose status is already 'booked' (a self-double, or an accepted invite). */
export async function bookDoubleNight(db: Db, g: GroupNight, visibility?: string): Promise<NightResult> {
  const bookerB = g.invite_to ?? g.created_by;
  const body = (couple: { character_id: string; partner_id: string }): Record<string, unknown> => ({
    character_id: couple.character_id,
    partner_id: couple.partner_id,
    group_night: g.id,
    ...(visibility ? { visibility } : {}),
  });
  const a = await book(g.created_by, body(g.couple_a));
  if (!a.ok) {
    const why = String(a.data.message ?? a.data.error ?? `refused (${a.status})`).slice(0, 300);
    await db.query(`update group_nights set status = 'lapsed', decided_at = now() where id = $1`, [g.id]).catch(() => {});
    if (g.invite_to) {
      await notify(db, g.invite_to, {
        kind: "double_date",
        title: "💞 The double date fell through",
        body: "The proposing couple's table couldn't be booked, so nothing was booked and you spent nothing.",
        link: null,
      }).catch(() => {});
    }
    return { ok: false, error: `Your couple's table couldn't be booked: ${why}` };
  }
  const episodeA = String(a.data.id ?? "");
  const b = await book(bookerB, body(g.couple_b));
  if (!b.ok) {
    const why = String(b.data.message ?? b.data.error ?? `refused (${b.status})`).slice(0, 300);
    // The booked date goes ahead solo: a spent date is a real date. The night is marked half, the tie removed.
    await db.query(`update group_nights set status = 'half_booked', decided_at = now() where id = $1`, [g.id]).catch(() => {});
    await db.query(`update episodes set group_id = null where id = $1`, [episodeA]).catch(() => {});
    await notify(db, g.created_by, {
      kind: "double_date",
      title: "💞 The other table fell through",
      body: `The other couple's table couldn't be booked (${why.slice(0, 160)}), so your couple's date goes ahead on its own.`,
      link: episodeA ? `/episodes/${episodeA}` : null,
    }).catch(() => {});
    return { ok: false, error: `The other couple's table couldn't be booked: ${why}`, episode_a: episodeA };
  }
  const episodeB = String(b.data.id ?? "");
  // One notice per booker (a self-double has one booker, so one notice).
  const notices: [string, string][] = g.created_by === bookerB ? [[g.created_by, episodeA]] : [[g.created_by, episodeA], [bookerB, episodeB]];
  for (const [to, episode] of notices) {
    await notify(db, to, {
      kind: "double_date",
      title: "💞💞 Your double date is booked",
      body: "Both tables are being written now; each couple's date airs the usual way, and either episode links the other.",
      link: `/episodes/${episode}`,
    }).catch(() => {});
  }
  return { ok: true, episode_a: episodeA, episode_b: episodeB };
}
