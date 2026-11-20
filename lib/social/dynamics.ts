/**
 * The living network (docs/PRDs/social-network.md section 7; Phase 4, SOCIAL_DYNAMICS): closeness that rises with what
 * aired and fades without it, and friendships that fade into old friends. The daily job runs it (app/api/jobs/daily, the
 * growth part, before the metrics, so they measure today's closeness).
 *
 * - **Closeness is the log's.** A tie's closeness today is worked out from its event log (`replayCloseness`, pure): an
 *   event that set closeness (the tie made, a declaration that changed it, a contact this job logged) sets it; an event
 *   that moved `last_contact_at` forward (a contact the derivations logged) lifts it CONTACT_GAIN of the way to 1, after
 *   the decay up to then; and the time since the last of them decays it by its kind's half-life (kinds.ts `halfLifeDays`).
 *   The daily write is the replay's answer, written over the row without an event (a day's drift isn't news), so running
 *   twice in a day changes nothing.
 * - **Contact reaches every tie of a pair.** Two friends who go on a date, share a house scene or a group night have been
 *   in touch, though the date is evidence on their `dated` tie. A declared tie (an owner's, an agent's, the house's) takes
 *   the pair's newer aired evidence (`episode:`, `scene:`, `night:` refs on their other public ties, never `talked_about`,
 *   whose subject wasn't there) through logContact, with the closeness it lifts to. A derived tie's evidence is its own
 *   record (lib/social/derive.ts writes it whole), so it gets its contact from there and nothing is added to it here.
 * - **What moves.** Active ties between two characters, every kind but `dated`, whose closeness is the pair's public tie
 *   strength, which their dates already move (lib/social/derive.ts datedTie). Contact lifts every one of them; kin,
 *   spouses, first loves, nemeses and old friends never decay (a null half-life). A tie to an off-screen person is left
 *   alone: they are never on screen, so no contact is no news.
 * - **Fading.** A friendship (a friendship-layer kind) whose closeness decays below FADED_BELOW ends with a `decayed`
 *   event, at the moment it crossed, and the pair become `old_friend` (derived, as visible as the friendship was, from
 *   when the friendship started). One that was set below it (a declaration) doesn't fade on that alone.
 * - **A budget.** Pages of ties by id; it stops between pages when the budget runs out and the next day's run starts again
 *   (the replay makes any order safe). At the show's size one run reads every tie.
 * - **Balance.** `unbalancedTriangles` finds two of the cast at odds who are both close to a third, in the public ties
 *   (2a's signedTriads), for the producer's `unbalanced_triangle` tension (lib/story-state.ts tensions).
 */
import type { Db } from "../db";
import { DELETED_OWNER } from "../rules";
import { signedTriads } from "./algorithms";
import { decay } from "./analytics";
import { isTieKind, TIE_KINDS, type TieKindId } from "./kinds";
import { socialTiesOn } from "./switch";
import { logContact, setStatus, upsertTie } from "./ties";
import type { Evidence, Tie } from "./types";

type Env = Record<string, string | undefined>;

/** The living network: contact, decay and fading, and the show's introductions (lib/social/introductions.ts). Off whenever SOCIAL_TIES is. */
export const socialDynamicsOn = (env: Env = process.env): boolean => socialTiesOn(env) && env.SOCIAL_DYNAMICS?.trim() !== "0";

/** How far one aired contact lifts closeness: this share of the way to 1. */
export const CONTACT_GAIN = 0.15;
/** A friendship that decays below this has faded: it ends (`decayed`) and the pair become old friends. */
export const FADED_BELOW = 0.15;
export const DYNAMICS_PAGE = 2000;
export const DYNAMICS_BUDGET_MS = 30_000;
/** At most this many contacts a tie takes in one run (a tie keeps its newest 20 pieces of evidence anyway). */
export const CONTACTS_A_RUN = 20;

const DAY_MS = 24 * 60 * 60 * 1000;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** The kinds the pass reads: all but `dated` (its closeness is the pair's public tie strength). */
export const MOVING_KINDS: readonly TieKindId[] = (Object.keys(TIE_KINDS) as TieKindId[]).filter((k) => k !== "dated");
/** The kinds that fade into old friends: the friendship layer's that decay (old_friend itself never does). */
export const FADING_KINDS: readonly TieKindId[] = MOVING_KINDS.filter((k) => TIE_KINDS[k].layer === "friendship" && TIE_KINDS[k].halfLifeDays !== null);
/** Evidence that is contact: an aired date, a house scene, a group night. */
export const CONTACT_REF = /^(episode|scene|night):/;
/** Ties whose evidence never counts as contact between their two (the subject of talk wasn't there). */
const NOT_CONTACT_KINDS: readonly TieKindId[] = ["talked_about"];
/** Who wrote a row: only these are the derivations' own, and keep their own evidence. */
const DERIVED = "derived";

/* ------------------------------------------------------ pure ------------------------------------------------------ */

/** One event as the replay reads it: when, the closeness it set (or null), and whether it was a contact. */
export type ReplayEvent = { at: string; closeness: number | null; contact: boolean };

/** Lifts closeness after a contact: `gain` of the way to 1. */
export const lift = (c: number, gain: number = CONTACT_GAIN): number => clamp01(c + gain * (1 - clamp01(c)));

/** Where the replay stands after the events: the closeness and the time of the last event that moved it, or null with none. */
export function replayState(events: readonly ReplayEvent[], halfLifeDays: number | null, gain: number = CONTACT_GAIN): { closeness: number; at: number } | null {
  let c: number | null = null;
  let t = 0;
  for (const e of events) {
    const at = Date.parse(e.at);
    if (!Number.isFinite(at)) continue;
    if (e.closeness !== null && Number.isFinite(e.closeness)) {
      c = clamp01(e.closeness);
      t = at;
    } else if (e.contact && c !== null) {
      c = lift(decay(c, (at - t) / DAY_MS, halfLifeDays), gain);
      t = Math.max(t, at);
    }
  }
  return c === null ? null : { closeness: c, at: t };
}

/** A tie's closeness at `now` from its events (pure), rounded as the table keeps it; null when no event ever set one. */
export function replayCloseness(events: readonly ReplayEvent[], halfLifeDays: number | null, now: Date, gain: number = CONTACT_GAIN): number | null {
  const s = replayState(events, halfLifeDays, gain);
  return s === null ? null : round3(decay(s.closeness, (now.getTime() - s.at) / DAY_MS, halfLifeDays));
}

/**
 * When a friendship faded (pure): the moment its closeness crossed `below` after the replay's last event, or null when it
 * hasn't by `now`, never decays, or was set at or below it (a declaration's own number isn't fading).
 */
export function fadedAt(events: readonly ReplayEvent[], halfLifeDays: number | null, now: Date, below: number = FADED_BELOW): Date | null {
  const s = replayState(events, halfLifeDays);
  if (!s || halfLifeDays === null || !(halfLifeDays > 0) || s.closeness < below || s.closeness <= 0) return null;
  const crossed = s.at + halfLifeDays * Math.log2(s.closeness / below) * DAY_MS;
  return crossed <= now.getTime() ? new Date(Math.max(crossed, s.at)) : null;
}

/**
 * An event row as the replay reads it (pure): the closeness it set ([from, to] in its changes), and whether it moved the
 * last contact forward. A tie made with evidence newer than its start (a derivation's backfill: a group-night tie made
 * from three nights at once) also had that newest contact, so its `created` row reads as the start and then a contact.
 */
export function replayEventsOf(r: { event: string; at: string | Date; changes: unknown }): ReplayEvent[] {
  const ch = r.changes && typeof r.changes === "object" ? (r.changes as Record<string, unknown>) : {};
  const pair = (v: unknown): [unknown, unknown] | null => (Array.isArray(v) && v.length === 2 ? [v[0], v[1]] : null);
  const time = (v: unknown): number => (v === null || v === undefined ? NaN : Date.parse(String(v)));
  const at = new Date(r.at).toISOString();
  const c = pair(ch.closeness);
  const closeness = c !== null && c[1] !== null && Number.isFinite(Number(c[1])) ? Number(c[1]) : null;
  const lc = pair(ch.last_contact_at);
  const to = lc ? time(lc[1]) : NaN;
  if (r.event === "created" || r.event === "proposed") {
    const out: ReplayEvent[] = [{ at, closeness, contact: false }];
    if (closeness !== null && to > Date.parse(at)) out.push({ at: new Date(to).toISOString(), closeness: null, contact: true });
    return out;
  }
  const moved = lc !== null && Number.isFinite(to) && !(time(lc[0]) >= to);
  return [{ at, closeness, contact: r.event === "contact" || moved }];
}

/* ----------------------------------------------------- the job ----------------------------------------------------- */

export type DynamicsRun = {
  /** Why it did nothing (switched off), or stopped short (the budget); null when it read every tie. */
  stopped: "off" | "budget" | null;
  /** Ties read, contacts logged, closeness rows written, friendships that faded. */
  ties: number;
  contacts: number;
  moved: number;
  faded: number;
  ms: number;
};

type MovingTie = Pick<Tie, "id" | "from_id" | "to_id" | "kind" | "closeness" | "visibility" | "source" | "evidence" | "started_at" | "created_at" | "last_contact_at">;

async function page(db: Db, after: string): Promise<MovingTie[]> {
  const { rows } = await db.query<{
    id: string;
    from_id: string;
    to_id: string;
    kind: string;
    closeness: number;
    visibility: string;
    source: string;
    evidence: unknown;
    started_at: string | Date | null;
    created_at: string | Date;
    last_contact_at: string | Date | null;
  }>(
    `select id, from_id, to_id, kind, closeness, visibility, source, evidence, started_at, created_at, last_contact_at
       from social_ties
      where status = 'active' and to_id is not null and kind = any($1::text[]) and id > $2
      order by id limit $3`,
    [[...MOVING_KINDS], after, DYNAMICS_PAGE],
  );
  const iso = (v: string | Date | null) => (v === null ? null : new Date(v).toISOString());
  return rows
    .filter((r) => isTieKind(r.kind))
    .map((r) => ({
      id: r.id,
      from_id: r.from_id,
      to_id: r.to_id,
      kind: r.kind as TieKindId,
      closeness: round3(Number(r.closeness)),
      visibility: r.visibility as Tie["visibility"],
      source: r.source as Tie["source"],
      evidence: Array.isArray(r.evidence) ? (r.evidence as Evidence[]) : [],
      started_at: iso(r.started_at),
      created_at: iso(r.created_at)!,
      last_contact_at: iso(r.last_contact_at),
    }));
}

/** Each tie's events as the replay reads them, oldest first, in one read. */
async function eventsOf(db: Db, ids: readonly string[]): Promise<Map<string, ReplayEvent[]>> {
  const out = new Map<string, ReplayEvent[]>(ids.map((id) => [id, []]));
  if (!ids.length) return out;
  const { rows } = await db.query<{ tie_id: string; event: string; at: string | Date; changes: unknown }>(
    `select tie_id, event, at, changes from social_tie_events where tie_id = any($1::text[]) order by tie_id, at, id`,
    [[...ids]],
  );
  for (const r of rows) out.get(r.tie_id)?.push(...replayEventsOf(r));
  return out;
}

/**
 * The aired contact each declared tie's pair had on their other public ties (refs it doesn't have yet), oldest first.
 * Only what came after the tie started: a pair's dates before they were friends don't lift the friendship.
 */
async function pairContacts(db: Db, ties: readonly MovingTie[]): Promise<Map<string, Evidence[]>> {
  const declared = ties.filter((t) => t.source !== DERIVED);
  const out = new Map<string, Evidence[]>();
  if (!declared.length) return out;
  const { rows } = await db.query<{ tie_id: string; ref: string; at: string }>(
    `select d.id as tie_id, e->>'ref' as ref, e->>'at' as at
       from social_ties d
       join social_ties o on o.id <> d.id and o.visibility = 'public' and o.to_id is not null and not (o.kind = any($2::text[]))
                         and ((o.from_id = d.from_id and o.to_id = d.to_id) or (o.from_id = d.to_id and o.to_id = d.from_id))
       cross join lateral jsonb_array_elements(case when jsonb_typeof(o.evidence) = 'array' then o.evidence else '[]'::jsonb end) e
      where d.id = any($1::text[]) and (e->>'ref') ~ '^(episode|scene|night):'`,
    [declared.map((t) => t.id), [...NOT_CONTACT_KINDS]],
  );
  const byId = new Map(declared.map((t) => [t.id, t]));
  for (const r of rows) {
    const t = byId.get(r.tie_id);
    const at = Date.parse(r.at);
    if (!t || !CONTACT_REF.test(r.ref) || !Number.isFinite(at)) continue;
    const since = Math.max(Date.parse(t.started_at ?? t.created_at), t.last_contact_at ? Date.parse(t.last_contact_at) : 0);
    if (at <= since || t.evidence.some((e) => e.ref === r.ref)) continue;
    const list = out.get(t.id) ?? [];
    if (!list.some((e) => e.ref === r.ref)) list.push({ ref: r.ref, at: new Date(at).toISOString() });
    out.set(t.id, list);
  }
  for (const [id, list] of out) out.set(id, list.sort((x, y) => x.at.localeCompare(y.at) || x.ref.localeCompare(y.ref)).slice(-CONTACTS_A_RUN));
  return out;
}

/** Writes each tie's replayed closeness over the row it was read from (the same closeness still there), no event. */
async function writeCloseness(db: Db, rows: readonly { id: string; from: number; to: number }[]): Promise<number> {
  if (!rows.length) return 0;
  const { rows: done } = await db.query<{ id: string }>(
    `update social_ties t set closeness = v.c, updated_at = now()
       from jsonb_to_recordset($1::jsonb) as v(id text, c real, was real)
      where t.id = v.id and t.status = 'active' and round(t.closeness::numeric, 3) = round(v.was::numeric, 3)
      returning t.id`,
    [JSON.stringify(rows.map((r) => ({ id: r.id, c: r.to, was: r.from })))],
  );
  return done.length;
}

/**
 * The daily pass (see the top of this file): every moving tie's contact, closeness and fading. Best effort, per tie: a
 * write that fails is logged and the rest go on.
 */
export async function runSocialDynamics(db: Db, o: { now?: Date; budgetMs?: number; env?: Env } = {}): Promise<DynamicsRun> {
  const env = o.env ?? process.env;
  const started = Date.now();
  const out: DynamicsRun = { stopped: null, ties: 0, contacts: 0, moved: 0, faded: 0, ms: 0 };
  if (!socialDynamicsOn(env)) return { ...out, stopped: "off" };
  const now = o.now ?? new Date();
  const deadline = started + (o.budgetMs ?? DYNAMICS_BUDGET_MS);
  let after = "";
  for (;;) {
    if (Date.now() > deadline) {
      out.stopped = "budget";
      break;
    }
    const ties = await page(db, after);
    if (!ties.length) break;
    after = ties[ties.length - 1].id;
    out.ties += ties.length;
    const [events, contacts] = await Promise.all([eventsOf(db, ties.map((t) => t.id)), pairContacts(db, ties)]);
    const writes: { id: string; from: number; to: number }[] = [];
    for (const t of ties) {
      if (Date.now() > deadline) {
        out.stopped = "budget";
        break;
      }
      const half = TIE_KINDS[t.kind].halfLifeDays;
      const log = events.get(t.id) ?? [];
      let stored = t.closeness;
      // The pair's newer aired contact, each lifting closeness from where the replay has it at that moment (an event is
      // never logged before the tie's last one: lib/social/ties.ts logEvent).
      for (const c of contacts.get(t.id) ?? []) {
        const last = log.reduce((m, e) => Math.max(m, Date.parse(e.at)), 0);
        const at = new Date(Math.max(Date.parse(c.at), last));
        const next = replayCloseness([...log, { at: at.toISOString(), closeness: null, contact: true }], half, at);
        if (next === null) break;
        try {
          const w = await logContact(db, t.id, { ref: c.ref, at: c.at, source: "derived", closeness: next }, env);
          if (!w.ok) break;
          if (w.event) {
            log.push({ at: at.toISOString(), closeness: next, contact: true });
            stored = w.tie.closeness;
            out.contacts++;
          }
        } catch (err) {
          console.error(`[social] contact on ${t.id} failed:`, err instanceof Error ? err.message : String(err));
          break;
        }
      }
      const faded = FADING_KINDS.includes(t.kind) ? fadedAt(log, half, now) : null;
      if (faded) {
        if (await fade(db, t, faded, replayCloseness(log, half, now) ?? FADED_BELOW, env)) out.faded++;
        continue;
      }
      const today = replayCloseness(log, half, now);
      if (today !== null && today !== round3(stored)) writes.push({ id: t.id, from: stored, to: today });
    }
    out.moved += await writeCloseness(db, writes);
    if (out.stopped || ties.length < DYNAMICS_PAGE) break;
  }
  return { ...out, ms: Date.now() - started };
}

/**
 * A friendship that faded: the pair become old friends (derived, as visible as it was, from when it started, carrying its
 * newest evidence), then it ends with a `decayed` event at the moment it crossed. In that order, so a failure in between
 * leaves the friendship to fade again tomorrow, and the old friends' write is a no-op then.
 */
async function fade(db: Db, t: MovingTie, at: Date, closeness: number, env: Env): Promise<boolean> {
  try {
    const newest = t.evidence[0];
    const old = await upsertTie(
      db,
      {
        from: t.from_id,
        to: t.to_id!,
        kind: "old_friend",
        source: "derived",
        visibility: t.visibility,
        closeness,
        started_at: t.started_at ?? t.created_at,
        detail: { was: t.kind },
        ...(newest ? { evidence: { ref: newest.ref, at: newest.at } } : {}),
      },
      env,
    );
    if (!old.ok) return false;
    const ended = await setStatus(db, t.id, "ended", { source: "derived", at, event: "decayed" }, env);
    return ended.ok && ended.event === "decayed";
  } catch (err) {
    console.error(`[social] fading ${t.id} failed:`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

/* ----------------------------------------------------- balance ----------------------------------------------------- */

/** How many unbalanced triangles the census keeps before they're narrowed to the cast. */
export const TRIANGLES_KEPT = 500;

/**
 * Two of the cast at odds who are both close to a third (`about`, anyone public), and the ties that say so: an
 * unbalanced triangle with exactly one negative side (PRD section 7, Balance). Three at odds is nobody's middle, so it's
 * left out. Public, active ties between public characters whose accounts still exist; a pair's sign is its ties'
 * valences summed (2a's signedTriads), so coworkers who are also rivals are neither. Empty when SOCIAL_DYNAMICS is off.
 */
export async function unbalancedTriangles(db: Db, cast: readonly string[], env: Env = process.env): Promise<{ a: string; b: string; about: string; ties: string[] }[]> {
  if (!socialDynamicsOn(env) || cast.length < 2) return [];
  const { rows } = await db.query<{ id: string; from_id: string; to_id: string; valence: number }>(
    `select t.id, t.from_id, t.to_id, t.valence from social_ties t
       join characters f on f.id = t.from_id and f.visibility = 'public' and f.owner_id is distinct from $2
       join characters o on o.id = t.to_id and o.visibility = 'public' and o.owner_id is distinct from $2
      where t.status = 'active' and t.visibility = 'public' and t.to_id is not null and t.valence <> 0
        and (t.from_id = any($1::text[]) or t.to_id = any($1::text[]))
      order by t.id`,
    [[...cast], DELETED_OWNER],
  );
  const census = signedTriads(rows.map((r) => ({ from: r.from_id, to: r.to_id, valence: Number(r.valence) })), { limit: TRIANGLES_KEPT });
  const inCast = new Set(cast);
  const pairOf = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const out: { a: string; b: string; about: string; ties: string[] }[] = [];
  for (const tri of census.triads) {
    if (tri.balanced || tri.signs.filter((s) => s < 0).length !== 1) continue;
    const [x, y, z] = tri.ids;
    const [xy, xz] = tri.signs;
    const [a, b, about] = xy < 0 ? [x, y, z] : xz < 0 ? [x, z, y] : [y, z, x];
    if (!inCast.has(a) || !inCast.has(b)) continue;
    const pairs = new Set([pairOf(a, b), pairOf(a, about), pairOf(b, about)]);
    out.push({ a, b, about, ties: rows.filter((r) => pairs.has(pairOf(r.from_id, r.to_id))).map((r) => r.id) });
  }
  return out;
}
