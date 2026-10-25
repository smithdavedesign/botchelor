/**
 * Dates booked for later (Agent World Phase 2, docs/PRDs/agent-world.md): `schedule_date` (listed at ?tools=all)
 * stores the booking, and the hourly lobby job runs the due ones through the same route as go_on_date — so the
 * budget, the swipe gate and every other booking rule apply AT RUN TIME, not when it's set. Born from the
 * 2026-10-25 prod runs: agents kept arriving to a spent shared budget and had nothing to do but come back; now
 * they can book for after the reset (initialize and my_status say when that is).
 *
 * Policy (mine): 2 minutes to 7 days out, at most 3 waiting per creator, free to set, spends the creator's
 * dates/budget when it runs. If the shared pool is full at run time it waits an hour and tries again, up to 6
 * tries, then gives up — and my_notifications says how it went either way (kind `scheduled_date`).
 */
import { POST as postEpisode } from "@/app/api/episodes/route";
import { agentDatesToday } from "./dating";
import type { Db } from "./db";
import { MCP_CALL_URL, USER_COOKIE } from "./http";
import { notify } from "./notifications";
import { operatorReserved } from "./operator-pass";

/** Waiting bookings one creator may hold. */
export const SCHEDULED_MAX_PENDING = 3;
/** How far out a booking may sit. */
export const SCHEDULED_MIN_MINUTES = 2;
export const SCHEDULED_MAX_DAYS = 7;
/** A run that finds the shared pool full waits an hour and tries again, this many times in all. */
const MAX_ATTEMPTS = 6;

export type ScheduledDate = {
  id: string;
  character_id: string;
  partner_id: string | null;
  run_at: string;
  visibility: string | null;
  place: string | null;
  attempts: number;
  outcome: string | null;
};

const row = (r: Record<string, unknown>): ScheduledDate => ({
  id: String(r.id),
  character_id: String(r.character_id),
  partner_id: (r.partner_id as string | null) ?? null,
  run_at: new Date(r.run_at as string).toISOString(),
  visibility: (r.visibility as string | null) ?? null,
  place: (r.place as string | null) ?? null,
  attempts: Number(r.attempts ?? 0),
  outcome: (r.outcome as string | null) ?? null,
});

/** A creator's waiting bookings, soonest first. */
export async function pendingScheduledDates(db: Db, creatorId: string): Promise<ScheduledDate[]> {
  const { rows } = await db.query(
    `select id, character_id, partner_id, run_at, visibility, place, attempts, outcome from scheduled_dates
      where creator_id = $1 and ran_at is null order by run_at`,
    [creatorId],
  );
  return rows.map(row);
}

export type ScheduleResult = { ok: true; scheduled: ScheduledDate } | { ok: false; error: string };

/** Store a booking for later. Cheap checks now; the full booking rules run when it runs. */
export async function scheduleDate(
  db: Db,
  creatorId: string,
  opts: { character_id: string; partner_id?: string | null; at: string; visibility?: string; place?: string },
  now: Date = new Date(),
): Promise<ScheduleResult> {
  const mine = (
    await db.query<{ id: string }>(`select id from characters where id = $1 and owner_id = $2 and not is_house`, [opts.character_id, creatorId])
  ).rows[0];
  if (!mine) return { ok: false, error: "character_id isn't one of your characters: my_status lists yours (create_character makes one)." };
  const at = new Date(opts.at ?? "");
  if (Number.isNaN(at.getTime())) return { ok: false, error: "at: an ISO-8601 time, like 2026-10-26T00:05:00Z." };
  const minutes = (at.getTime() - now.getTime()) / 60_000;
  if (minutes < SCHEDULED_MIN_MINUTES || minutes > SCHEDULED_MAX_DAYS * 24 * 60) {
    return { ok: false, error: `at: between ${SCHEDULED_MIN_MINUTES} minutes and ${SCHEDULED_MAX_DAYS} days from now. The shared budget resets at 00:00 UTC.` };
  }
  if (opts.partner_id) {
    const partner = (
      await db.query<{ id: string }>(`select id from characters where id = $1 and visibility <> 'private' and owner_id is distinct from 'deleted'`, [opts.partner_id])
    ).rows[0];
    if (!partner) return { ok: false, error: "partner_id: no character with that id (search_characters and swipe_deck list them). Leave it out for a blind date." };
  }
  const pending = await db.query(`select 1 from scheduled_dates where creator_id = $1 and ran_at is null`, [creatorId]);
  if (pending.rows.length >= SCHEDULED_MAX_PENDING) {
    return { ok: false, error: `${SCHEDULED_MAX_PENDING} bookings are already waiting (schedule_date { list: true } shows them; cancel: <id> calls one off).` };
  }
  const visibility = opts.visibility === "public" || opts.visibility === "unlisted" || opts.visibility === "private" ? opts.visibility : null;
  const inserted = (
    await db.query(
      `insert into scheduled_dates (id, creator_id, character_id, partner_id, run_at, visibility, place)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, character_id, partner_id, run_at, visibility, place, attempts, outcome`,
      [crypto.randomUUID(), creatorId, opts.character_id, opts.partner_id ?? null, at.toISOString(), visibility, opts.place?.slice(0, 60) ?? null],
    )
  ).rows[0];
  return { ok: true, scheduled: row(inserted) };
}

/** Call off a waiting booking of yours. */
export async function cancelScheduledDate(db: Db, creatorId: string, id: string): Promise<boolean> {
  const r = await db.query(`delete from scheduled_dates where id = $1 and creator_id = $2 and ran_at is null returning id`, [id, creatorId]);
  return r.rows.length > 0;
}

/** The same internal call go_on_date makes (dispatcher callRoute): the creator's cookie is its identity. */
async function book(creatorId: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const req = new Request(MCP_CALL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${USER_COOKIE}=${creatorId}` },
    body: JSON.stringify(body),
  });
  const res = await postEpisode(req);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

/**
 * Run the due bookings (the hourly lobby job). Each is claimed first (ran_at set in the same statement), so an
 * overlapping run can't book one twice; a full shared pool puts it back for the next hour, up to MAX_ATTEMPTS.
 */
export async function runDueScheduledDates(db: Db, now: Date = new Date(), limit = 3): Promise<{ ran: number; booked: number; waiting: number; failed: number }> {
  const due = (
    await db.query(
      `update scheduled_dates set ran_at = $1, attempts = attempts + 1
        where id in (select id from scheduled_dates where ran_at is null and run_at <= $1 order by run_at limit $2)
        returning id, creator_id, character_id, partner_id, run_at, visibility, place, attempts`,
      [now.toISOString(), limit],
    )
  ).rows as { id: string; creator_id: string; character_id: string; partner_id: string | null; visibility: string | null; place: string | null; attempts: number }[];
  const out = { ran: due.length, booked: 0, waiting: 0, failed: 0 };
  for (const m of due) {
    // The agents' shared daily budget, exactly as go_on_date checks it; an operator pass with reserved dates jumps it.
    const today = await agentDatesToday(db);
    const reserved = ((await operatorReserved(db, m.creator_id).catch(() => null))?.reserved_left ?? 0) > 0;
    if (today.used >= today.cap && !(today.cap > 0 && reserved)) {
      if (m.attempts < MAX_ATTEMPTS) {
        await db.query(`update scheduled_dates set ran_at = null, run_at = $2, outcome = $3 where id = $1`, [
          m.id,
          new Date(now.getTime() + 60 * 60_000).toISOString(),
          "waiting: the agents' shared dates were used up; trying again in an hour",
        ]);
        out.waiting += 1;
      } else {
        await db.query(`update scheduled_dates set outcome = $2 where id = $1`, [m.id, "gave up: the shared pool stayed full"]);
        await notify(db, m.creator_id, {
          kind: "scheduled_date",
          title: "📅 Your scheduled date couldn't run",
          body: `The agents' shared show-model dates stayed used up through ${MAX_ATTEMPTS} hourly tries, so the booking was dropped. Schedule it again for just after 00:00 UTC, or an operator pass reserves dates (/agents/pricing).`,
          link: null,
        }).catch(() => {});
        out.failed += 1;
      }
      continue;
    }
    const body: Record<string, unknown> = {
      character_id: m.character_id,
      ...(m.partner_id ? { partner_id: m.partner_id } : { blind: true }),
      ...(m.visibility ? { visibility: m.visibility } : {}),
      ...(m.place ? { place: m.place } : {}),
    };
    const r = await book(m.creator_id, body);
    if (r.ok) {
      const episodeId = String(r.data.id ?? "");
      await db.query(`update episodes set created_via = 'mcp' where id = $1`, [episodeId]).catch(() => {});
      await db.query(`update scheduled_dates set episode_id = $2, outcome = 'booked' where id = $1`, [m.id, episodeId]);
      await notify(db, m.creator_id, {
        kind: "scheduled_date",
        title: "📅 Your scheduled date is booked",
        body: "It's being written now; get_episode has it, and it airs the usual way.",
        link: episodeId ? `/episodes/${episodeId}` : null,
      }).catch(() => {});
      out.booked += 1;
    } else {
      const why = String(r.data.message ?? r.data.error ?? `refused (${r.status})`).slice(0, 300);
      await db.query(`update scheduled_dates set outcome = $2 where id = $1`, [m.id, why.slice(0, 120)]);
      await notify(db, m.creator_id, {
        kind: "scheduled_date",
        title: "📅 Your scheduled date couldn't be booked",
        body: `${why} Nothing was spent beyond what the reply says; schedule_date again once it's fixed.`,
        link: null,
      }).catch(() => {});
      out.failed += 1;
    }
  }
  return out;
}
