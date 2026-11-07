/**
 * Books both tables of a double date (lib/group-dates.ts) through the same route as go_on_date — the proposer's
 * couple as the proposer, the other couple as its own booker — so caps, consent and every booking rule apply per
 * booker. Kept out of lib/group-dates.ts because this imports the route, and the route imports that module.
 *
 * Dates first (#1318): before anything books, each booker must have the dates the night spends — two from a
 * self-double's one booker, one from each otherwise. Short, and nothing books or is spent: a short acceptor keeps the
 * invite open, a short proposer's night lapses.
 *
 * Half a night: if the proposer's table can't book (a block, a taken partner), nothing books and the night lapses.
 * If theirs books and the other side's doesn't, the booked date goes ahead solo (its group_id is cleared) and both
 * hear why — a spent date is a real date, never thrown away. Every message is worded for whoever asked (`asker`).
 */
import { POST as postEpisode } from "@/app/api/episodes/route";
import type { Db } from "./db";
import { INVITE_DAYS, MIXER_DOORS_MINUTES, MIXER_MAX, MIXER_MIN, MIXER_WAIT_HOURS, mixerSeats, openMixer, type GroupNight, type Rotation } from "./group-dates";
import { seedFrom } from "./engine";
import { MCP_CALL_URL, USER_COOKIE } from "./http";
import { shortName } from "./names";
import { notify } from "./notifications";
import { venuePhrase } from "./venues";
import { playOrder, roundOf } from "./mixer-room";
import { fillMixerTonight } from "./mixer-fill";
import { writeRoomOpening } from "./mixer-voice";
import { HOUSE_BOOKER, markHouseRequest } from "./house-booker";
import { episodeAllowance } from "./allowance";
import { operatorReserved } from "./operator-pass";

async function book(asUserId: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const req = new Request(MCP_CALL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${USER_COOKIE}=${asUserId}` },
    body: JSON.stringify(body),
  });
  // The house booking its cast's rotations (lib/house-booker.ts): only a request built here can act as the house.
  if (asUserId === HOUSE_BOOKER) markHouseRequest(req);
  const res = await postEpisode(req);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

export type NightResult =
  | { ok: true; episode_a: string; episode_b: string }
  | { ok: false; error: string; episode_a?: string };

/** Dates a booker could spend now: this week's free ones, pack dates, and an operator pass's reserved ones. */
async function datesOnHand(db: Db, userId: string): Promise<{ have: number; resets_at: string }> {
  const [left, reserved] = await Promise.all([episodeAllowance(db, userId), operatorReserved(db, userId).catch(() => null)]);
  return { have: left.left + (reserved?.reserved_left ?? 0), resets_at: left.resets_at };
}

/**
 * #1318: the booker short of the dates this night spends (two from a self-double's one booker, one from each booker
 * otherwise), or null when both have enough. Checked before anything books, so a short side never leaves the other
 * table spent. Only the budget: every other rule is still the booking route's, per table.
 */
export async function doubleShortfall(db: Db, g: GroupNight): Promise<{ booker: string; need: number; have: number; resets_at: string } | null> {
  const bookerB = g.invite_to ?? g.created_by;
  const needs: [string, number][] = bookerB === g.created_by ? [[g.created_by, 2]] : [[g.created_by, 1], [bookerB, 1]];
  for (const [booker, need] of needs) {
    const { have, resets_at } = await datesOnHand(db, booker);
    if (have < need) return { booker, need, have, resets_at };
  }
  return null;
}

/** "Juni and Lotte": a couple by first names, for the messages below. */
async function coupleNames(db: Db, couple: { character_id: string; partner_id: string }): Promise<string> {
  const { rows } = await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [[couple.character_id, couple.partner_id]]);
  const name = (id: string) => shortName(rows.find((r) => r.id === id)?.name ?? "someone");
  return `${name(couple.character_id)} and ${name(couple.partner_id)}`;
}

const dateCount = (n: number) => (n === 1 ? "1 date" : `${n} dates`);
/** The route's reason as a sentence, so the line after it reads on. */
const sentence = (why: string) => (/[.!?)]$/.test(why.trim()) ? why.trim() : `${why.trim()}.`);

/**
 * Books a night whose status is already 'booked' (a self-double, or an accepted invite). `asker` is whoever asked
 * (the proposer for a self-double, the invitee for an accept): the error is worded for them, naming whose table it was.
 */
export async function bookDoubleNight(db: Db, g: GroupNight, visibility?: string, asker: string = g.created_by): Promise<NightResult> {
  const bookerB = g.invite_to ?? g.created_by;
  const self = bookerB === g.created_by;
  const askerIsA = asker === g.created_by;
  const body = (couple: { character_id: string; partner_id: string }): Record<string, unknown> => ({
    character_id: couple.character_id,
    partner_id: couple.partner_id,
    group_night: g.id,
    ...(visibility ? { visibility } : {}),
  });
  // Whose table, as the asker hears it: in a self-double both are theirs (first and second).
  const tableOf = async (side: "a" | "b"): Promise<string> => {
    const names = await coupleNames(db, side === "a" ? g.couple_a : g.couple_b);
    if (self) return `Your ${side === "a" ? "first" : "second"} table (${names})`;
    const mine = (side === "a") === askerIsA;
    return mine ? `Your couple's table (${names})` : `The other couple's table (${names})`;
  };

  const short = await doubleShortfall(db, g);
  if (short) {
    const back = `Free dates come back at ${short.resets_at}, or a pack from the shop (/shop) adds dates.`;
    if (g.invite_to && short.booker === g.invite_to) {
      // The invitee is short: un-accept, so the invite stays theirs to accept once they have a date.
      await db.query(`update group_nights set status = 'invited', decided_at = null where id = $1 and status = 'booked'`, [g.id]).catch(() => {});
      const lapses = new Date(new Date(g.created_at).getTime() + INVITE_DAYS * 24 * 60 * 60_000).toISOString();
      return {
        ok: false,
        error:
          asker === g.invite_to
            ? `Accepting spends one of your dates on your table, and you have none left, so nothing was booked and nothing was spent. The invite stays open until ${lapses}: accept it again once you have a date. ${back}`
            : `The other couple's booker has no dates left for their table, so nothing was booked and nothing was spent. The invite stays open until ${lapses}.`,
      };
    }
    await db.query(`update group_nights set status = 'lapsed', decided_at = now() where id = $1`, [g.id]).catch(() => {});
    if (self) {
      return {
        ok: false,
        error: `A self-double spends ${dateCount(2)} of yours (one per table) and you have ${dateCount(short.have)} left, so nothing was booked and nothing was spent. ${back}`,
      };
    }
    // The proposer is short (their dates went since they invited): the night can't book, and the invitee spent nothing.
    if (askerIsA) return { ok: false, error: `Your couple's table needs one of your dates and you have none left, so nothing was booked and nothing was spent. ${back}` };
    await notify(db, g.created_by, {
      kind: "double_date",
      title: "💞 The double date fell through",
      body: "Your double-date invite was accepted, but you had no dates left for your couple's table, so nothing was booked and nothing was spent.",
      link: null,
    }).catch(() => {});
    return { ok: false, error: "The proposing couple's booker has no dates left for their table, so nothing was booked and you spent nothing." };
  }

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
    return { ok: false, error: `${await tableOf("a")} couldn't be booked: ${sentence(why)} Nothing was booked, and nothing was spent.` };
  }
  const episodeA = String(a.data.id ?? "");
  const b = await book(bookerB, body(g.couple_b));
  if (!b.ok) {
    const why = String(b.data.message ?? b.data.error ?? `refused (${b.status})`).slice(0, 300);
    // The booked date goes ahead solo: a spent date is a real date. The night is marked half, the tie removed.
    await db.query(`update group_nights set status = 'half_booked', decided_at = now() where id = $1`, [g.id]).catch(() => {});
    await db.query(`update episodes set group_id = null where id = $1`, [episodeA]).catch(() => {});
    const [tableA, tableB] = [await tableOf("a"), await tableOf("b")];
    await notify(db, g.created_by, {
      kind: "double_date",
      title: self ? "💞 Your second table fell through" : "💞 The other table fell through",
      body: self
        ? `Your second table couldn't be booked (${why.slice(0, 160)}), so your first table's date goes ahead on its own.`
        : `The other couple's table couldn't be booked (${why.slice(0, 160)}), so your couple's date goes ahead on its own.`,
      link: episodeA ? `/episodes/${episodeA}` : null,
    }).catch(() => {});
    // The first table is kept, and says so: which one, its episode, and that its date was spent (it isn't given back).
    const kept = self || askerIsA ? "it spent one of your dates" : "it spent one of theirs, and you spent nothing";
    return {
      ok: false,
      error: `${tableB} couldn't be booked: ${sentence(why)} ${tableA} was already booked, so it goes ahead as a date on its own (episode ${episodeA}; ${kept}).`,
      episode_a: episodeA,
    };
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
function drawRotations(nightId: string, seats: { character_id: string; booker: string; house_fill?: boolean }[]): Rotation[] {
  const order = [...seats];
  let seed = seedFrom(nightId);
  for (let i = order.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  // A circle: everyone meets their two neighbours, and books exactly one of those rotations (one date each). Each
  // rotation carries the round the bell calls it in (lib/mixer-room.ts): the room plays round by round.
  return order.map((s, i) => ({ a: s.character_id, b: order[(i + 1) % order.length].character_id, booker: s.booker, round: roundOf(i, order.length), ...(s.house_fill ? { house_paid: true } : {}) }));
}

export type MixerRun = { ran: number; booked: number; failed: number; cancelled: number; waiting: number; filled?: number };

/**
 * Runs the open mixer when it's due (the hourly lobby job): enough singles in and the doors open a while (or full).
 * Each rotation books a speed_date through the same route as go_on_date as its own booker — one date per
 * participant for the whole night. A mixer that never fills is called off, and nothing is spent.
 */
export async function runDueMixers(db: Db, now: Date = new Date()): Promise<MixerRun> {
  const out: MixerRun = { ran: 0, booked: 0, failed: 0, cancelled: 0, waiting: 0 };
  // The nightly fill (lib/mixer-fill.ts): at the fill hour the house tops tonight's mixer up, or seats one of its own.
  const fill = await fillMixerTonight(db, now).catch(() => null);
  if (fill) out.filled = fill.filled;
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
  // A night the house filled runs on that pass: the fill hour is its doors closing.
  if (open.seats.length < MIXER_MAX && age < MIXER_DOORS_MINUTES * 60_000 && !open.night.filled_at) {
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
  // The room's opening, written once now (lib/mixer-voice.ts: one short call, the template if it fails).
  await writeRoomOpening(db, open.night.id).catch(() => false);
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
  // The house's fillers get no wrap: their scripts aren't waiting on one, and the reflect ask is for people and agents.
  for (const seat of open.seats.filter((x) => !x.house_fill)) {
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

/**
 * Runs a night the house has already seated (the recoupling night, lib/recoupling.ts): draws the rotations, writes the
 * room's opening, books every rotation through the same route as go_on_date as its seat's booker (house_paid, like the
 * nightly fill), and closes the night. `noteFor` is the producer's one-sided channel — the audience's voted couple gets
 * a note its date partner never sees, the same channel a dare would use (lib/simulation.ts req.note).
 */
export async function runSeatedNight(
  db: Db,
  nightId: string,
  opts: { noteFor?: (a: string, b: string) => string | null } = {},
): Promise<{ booked: number; failed: number }> {
  const seats = await mixerSeats(db, nightId);
  const rotations = drawRotations(nightId, seats);
  const claimed = await db.query(
    `update group_nights set rotations = $2::jsonb, status = 'running', decided_at = now() where id = $1 and status = 'open' returning id`,
    [nightId, JSON.stringify(rotations)],
  );
  if (!claimed.rows.length) return { booked: 0, failed: 0 };
  await writeRoomOpening(db, nightId).catch(() => false);
  let booked = 0;
  let failed = 0;
  for (const i of playOrder(rotations)) {
    const r = rotations[i];
    const note = opts.noteFor?.(r.a, r.b) ?? null;
    const res = await book(r.booker, { character_id: r.a, partner_id: r.b, group_night: nightId, format: "speed_date", ...(note ? { note } : {}) });
    if (res.ok) booked += 1;
    else {
      failed += 1;
      const why = String(res.data.message ?? res.data.error ?? `refused (${res.status})`).slice(0, 160);
      await db
        .query(`update group_nights set rotations = jsonb_set(rotations, $2::text[], to_jsonb($3::text)) where id = $1`, [nightId, `{${i},failed}`, why])
        .catch(() => {});
    }
  }
  await db.query(`update group_nights set status = $2 where id = $1`, [nightId, booked ? "done" : "cancelled"]);
  return { booked, failed };
}
