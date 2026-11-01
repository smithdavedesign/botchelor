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
import { MIXER_DOORS_MINUTES, MIXER_MAX, MIXER_MIN, MIXER_WAIT_HOURS, openMixer, type GroupNight, type Rotation } from "./group-dates";
import { seedFrom } from "./engine";
import { MCP_CALL_URL, USER_COOKIE } from "./http";
import { shortName } from "./names";
import { notify } from "./notifications";
import { venuePhrase } from "./venues";
import { playOrder, roundOf } from "./mixer-room";

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

/* ------------------------------------------------ mixers (M2) ------------------------------------------------ */

/** The same dealt shuffle every run would deal (seeded by the night), so a retry can't redraw who meets whom. */
function drawRotations(nightId: string, seats: { character_id: string; booker: string }[]): Rotation[] {
  const order = [...seats];
  let seed = seedFrom(nightId);
  for (let i = order.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  // A circle: everyone meets their two neighbours, and books exactly one of those rotations (one date each). Each
  // rotation carries the round the bell calls it in (lib/mixer-room.ts): the room plays round by round.
  return order.map((s, i) => ({ a: s.character_id, b: order[(i + 1) % order.length].character_id, booker: s.booker, round: roundOf(i, order.length) }));
}

export type MixerRun = { ran: number; booked: number; failed: number; cancelled: number; waiting: number };

/**
 * Runs the open mixer when it's due (the hourly lobby job): enough singles in and the doors open a while (or full).
 * Each rotation books a speed_date through the same route as go_on_date as its own booker — one date per
 * participant for the whole night. A mixer that never fills is called off, and nothing is spent.
 */
export async function runDueMixers(db: Db, now: Date = new Date()): Promise<MixerRun> {
  const out: MixerRun = { ran: 0, booked: 0, failed: 0, cancelled: 0, waiting: 0 };
  const open = await openMixer(db).catch(() => null);
  if (!open) return out;
  const age = now.getTime() - new Date(open.night.created_at).getTime();
  if (open.seats.length < MIXER_MIN) {
    if (age > MIXER_WAIT_HOURS * 60 * 60_000) {
      const off = await db.query(`update group_nights set status = 'cancelled', decided_at = $2 where id = $1 and status = 'open' returning id`, [
        open.night.id,
        now.toISOString(),
      ]);
      if (off.rows.length) {
        out.cancelled = 1;
        for (const booker of new Set(open.seats.map((s) => s.booker))) {
          const theirs = open.seats.find((x) => x.booker === booker)!;
          await notify(db, booker, {
            kind: "mixer",
            title: "🍸 The mixer was called off",
            body: `Fewer than ${MIXER_MIN} singles came in ${MIXER_WAIT_HOURS} hours, so nothing ran and nothing was spent. The next mixer opens as soon as someone joins.`,
            link: `/characters/${theirs.character_id}`,
          }).catch(() => {});
        }
      }
    } else out.waiting = 1;
    return out;
  }
  if (open.seats.length < MIXER_MAX && age < MIXER_DOORS_MINUTES * 60_000) {
    out.waiting = 1; // enough to run, but the doors stay open a little for late joiners
    return out;
  }
  // Claim it (an overlapping run finds it 'running' and does nothing), then draw who meets whom.
  const rotations = drawRotations(open.night.id, open.seats);
  const claimed = await db.query(
    `update group_nights set rotations = $2::jsonb, status = 'running', decided_at = $3 where id = $1 and status = 'open' returning id`,
    [open.night.id, JSON.stringify(rotations), now.toISOString()],
  );
  if (!claimed.rows.length) return out;
  out.ran = 1;
  const names = new Map(open.seats.map((s) => [s.character_id, s.name]));
  // Booked round by round (lib/mixer-room.ts playOrder), so a later round's room line knows how the earlier ones looked.
  for (const i of playOrder(rotations)) {
    const r = rotations[i];
    const res = await book(r.booker, { character_id: r.a, partner_id: r.b, group_night: open.night.id, format: "speed_date" });
    if (res.ok) out.booked += 1;
    else {
      out.failed += 1;
      const why = String(res.data.message ?? res.data.error ?? `refused (${res.status})`).slice(0, 160);
      await db
        .query(`update group_nights set rotations = jsonb_set(rotations, $2::text[], to_jsonb($3::text)) where id = $1`, [open.night.id, `{${i},failed}`, why])
        .catch(() => {});
    }
  }
  await db.query(`update group_nights set status = $2 where id = $1`, [open.night.id, out.booked ? "done" : "cancelled"]);
  // The wrap: your rotations, and the ask that makes the night compound (David 2026-10-25: reflect on who you liked).
  // 2026-10-25 page review: it links the character's own date from the night (it had no link: a dead end on the web),
  // and speaks to people first; agents get the tool names in brackets.
  for (const seat of open.seats) {
    const first = shortName(names.get(seat.character_id) ?? "someone");
    const mine = rotations.filter((r) => (r.a === seat.character_id || r.b === seat.character_id) && !r.failed);
    const met = mine.map((r) => shortName(names.get(r.a === seat.character_id ? r.b : r.a) ?? "someone"));
    await notify(db, seat.booker, {
      kind: "mixer",
      title: out.booked ? `🍸 ${first} went to the mixer at ${venuePhrase(open.night.venue)}` : "🍸 The mixer couldn't run",
      body: out.booked
        ? `${first} met ${met.join(" and ") || "nobody (their rotations fell through)"} in one room: six lines each, round by round, being written now. ` +
          `Once they air, everyone there is in ${first}'s memory, and you can say what ${first} thought of each of them on their relationship board. ` +
          `(Agents: reflect_on_date for each date, remember_meeting for the singles ${first} didn't meet.)`
        : "No rotation could be booked, so nothing ran. Nothing was spent beyond what each refusal said.",
      // 2026-11-01: the whole room is the night (/mixers/[id]); each table's own page links back to it.
      link: out.booked ? `/mixers/${open.night.id}` : `/characters/${seat.character_id}`,
    }).catch(() => {});
  }
  return out;
}

