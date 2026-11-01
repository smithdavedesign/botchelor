/**
 * The nightly fill (David 2026-11-01: "we can fill it every night with an agent-made character if it isn't full").
 * At MIXER_FILL_HOUR_UTC the hourly lobby job (it runs at :20, so 20:20 UTC) looks at tonight's mixer:
 *
 *  - an open mixer short of MIXER_MIN is topped up to MIXER_MIN with characters from the labelled house crowd
 *    (lib/house-bots.ts: agent-made characters the show's own scripts play), and runs on that same pass;
 *  - no mixer at all, and none ran today: the house seats one of its own, 4–6 of the crowd, so there's always a
 *    mixer to watch.
 *
 * Once a UTC day (group_nights.filled_at). Fillers sit in group_night_seats with house_fill, and their rotations are
 * house_paid: the booking route spends none of the bot's own dates for them (the house pays the normal model cost,
 * about a cent a speed date). The night page tags every house-run seat "House".
 *
 * Who can fill: a house-crowd character that's public, open to dates, not taken (a one-partner couple), not unmatched
 * with anyone already in the room or with another filler, not across a block with anyone seated, whose audience
 * setting allows the room (and the room's allows agent-made characters) — and that didn't fill yesterday's mixer, so
 * the same faces don't come back two nights in a row. The season's house cast (is_house) never fills: every seat books
 * its own rotation, and the house cast has no booker.
 *
 * Off with HOUSE_CROWD_PAUSED=1 (the crowd's switch) or MIXER_HOUSE_FILL=0.
 */
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { MIXER_FILL_HOUR_UTC, MIXER_MAX, MIXER_MIN, openMixer } from "./group-dates";
import { houseCrowdPaused, isHouseBotSql } from "./house-bots";
import { takenSql } from "./partners";
import type { PlaceId } from "./venues";

export { MIXER_FILL_HOUR_UTC };
/** Where a house-only night happens (the same rooms a people's mixer is dealt). */
const FILL_VENUES: readonly PlaceId[] = ["dive_bar", "jazz_bar", "rooftop_bar", "night_market"];

export function mixerFillOn(env: Record<string, string | undefined> = process.env): boolean {
  return !houseCrowdPaused(env) && env.MIXER_HOUSE_FILL !== "0";
}

export type FillResult = { night_id: string; filled: number; created: boolean };

const utcDay = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export async function fillMixerTonight(db: Db, now: Date = new Date(), env: Record<string, string | undefined> = process.env): Promise<FillResult | null> {
  if (!mixerFillOn(env) || now.getUTCHours() < MIXER_FILL_HOUR_UTC) return null;
  const today = utcDay(now);
  const yesterday = new Date(today.getTime() - 86_400_000);
  const done = (
    await db.query<{ filled: boolean; ran: boolean }>(
      `select bool_or(filled_at >= $1) as filled, bool_or(status = 'done' and decided_at >= $1) as ran from group_nights where kind = 'mixer'`,
      [today.toISOString()],
    )
  ).rows[0];
  if (done?.filled) return null;
  const open = await openMixer(db);
  if (open && open.seats.length >= MIXER_MIN) return null; // it runs on its own
  if (!open && done?.ran) return null; // there's already a mixer to watch tonight
  const seated = open?.seats.map((s) => s.character_id) ?? [];
  const dayKey = today.toISOString().slice(0, 10);
  const target = open ? MIXER_MIN : MIXER_MIN + (seedFrom("mixer-fill", dayKey) % (MIXER_MAX - MIXER_MIN + 1));
  const need = target - seated.length;
  if (need <= 0) return null;

  // The room's audience settings: anyone seated who wants people only means no agent-made filler; a filler's own
  // setting must allow how everyone seated was made.
  const room = (
    await db.query<{ created_via: string; open_audience: string }>(`select created_via, open_audience from characters where id = any($1)`, [seated])
  ).rows;
  if (room.some((r) => r.open_audience === "people")) return null;
  const vias = [...new Set(room.map((r) => (r.created_via === "mcp" ? "mcp" : "web")))];

  const { rows: pool } = await db.query<{ id: string; owner_id: string }>(
    `select c.id, c.owner_id from characters c
      where not c.is_house and c.owner_id is not null and c.owner_id <> 'deleted'
        and ${isHouseBotSql("c.owner_id")}
        and c.open_to_dates and c.visibility = 'public'
        and not ${takenSql("c")}
        and c.id <> all($1::text[])
        and (c.open_audience = 'everyone'
             or (c.open_audience = 'agents' and not ('web' = any($3::text[])))
             or (c.open_audience = 'people' and not ('mcp' = any($3::text[])) and cardinality($3::text[]) > 0))
        and not exists (select 1 from group_night_seats gs where gs.character_id = c.id and gs.house_fill and gs.joined_at >= $2)
        and not exists (select 1 from unmatches um
                         where (um.character_lo = c.id and um.character_hi = any($1::text[])) or (um.character_hi = c.id and um.character_lo = any($1::text[])))
        and not exists (select 1 from characters s join blocks bl
                          on (bl.blocker_id = s.owner_id and bl.blocked_id = c.owner_id) or (bl.blocker_id = c.owner_id and bl.blocked_id = s.owner_id)
                         where s.id = any($1::text[]))
      limit 200`,
    [seated, yesterday.toISOString(), vias],
  );
  // A different few each night, dealt from the day, never two who unmatched each other.
  const order = [...pool].sort((x, y) => seedFrom(dayKey, x.id) - seedFrom(dayKey, y.id) || (x.id < y.id ? -1 : 1));
  const ids = order.map((c) => c.id);
  const unmatched = ids.length
    ? (await db.query<{ character_lo: string; character_hi: string }>(`select character_lo, character_hi from unmatches where character_lo = any($1) and character_hi = any($1)`, [ids])).rows
    : [];
  const apart = (x: string, y: string) => unmatched.some((u) => (u.character_lo === x && u.character_hi === y) || (u.character_lo === y && u.character_hi === x));
  const picked: { id: string; owner_id: string }[] = [];
  for (const c of order) {
    if (picked.length >= need) break;
    if (picked.some((p) => apart(p.id, c.id))) continue;
    picked.push(c);
  }
  if (picked.length < need) return null; // not enough of the crowd free tonight: the night stays as it is

  let nightId = open?.night.id ?? null;
  const created = !nightId;
  if (!nightId) {
    nightId = crypto.randomUUID();
    await db.query(
      `insert into group_nights (id, kind, venue, created_by, status, couple_a, couple_b) values ($1, 'mixer', $2, 'house', 'open', '{}'::jsonb, '{}'::jsonb)`,
      [nightId, FILL_VENUES[seedFrom(nightId) % FILL_VENUES.length]],
    );
  }
  // Claim the day first (an overlapping pass finds it filled and does nothing), then seat them.
  const claimed = await db.query(`update group_nights set filled_at = $2 where id = $1 and status = 'open' and filled_at is null returning id`, [nightId, now.toISOString()]);
  if (!claimed.rows.length) return null;
  for (const [k, c] of picked.entries()) {
    await db.query(
      `insert into group_night_seats (night_id, character_id, booker, house_fill, joined_at) values ($1, $2, $3, true, $4) on conflict do nothing`,
      [nightId, c.id, c.owner_id, new Date(now.getTime() + k).toISOString()],
    );
  }
  return { night_id: nightId, filled: picked.length, created };
}
