/**
 * The tie store's write layer (docs/PRDs/social-network.md sections 4 and 5.2-5.3). Every write to `social_ties` goes
 * through here, so the rules hold everywhere:
 *
 *  - **One row a pair a kind.** The key is (from, to or person, kind), a symmetric pair ordered (`tieKey`); its id is a
 *    hash of the key (`tieIdOf`), the same in every database, so a dataset's ids stay stable.
 *  - **Idempotent.** The same write twice changes nothing and logs nothing. Evidence accumulates on the row (newest
 *    first, at most EVIDENCE_KEPT, each ref once), so a backfill can run over what a live hook already wrote.
 *  - **Events, then state.** Every change appends one social_tie_events row: `created` (or `proposed`), `changed` with
 *    the fields' [from, to], `ended`/`revived`/`accepted`/`declined` for a status move, or `contact` when the only news is
 *    new evidence. Nothing is overwritten silently.
 *  - **Declared beats derived.** A derived write (`source: "derived"`) on a row someone declared adds its evidence, its
 *    contact and its detail, and never rewrites what they declared (visibility, story, valence, status). A declared write
 *    on a derived row makes it declared.
 *  - **Never a person's id in jsonb.** `changes`, `detail` and evidence never hold one; who did it is `actor`, and who
 *    declared or answered are `created_by` and `answered_by` (lib/person-columns.ts), which deleting an account reaches.
 *  - **Best effort from the site.** A hook in a date, a scene or a page wraps its write in `safely`, which also honours
 *    the SOCIAL_TIES switch: no date or page ever waits on, or fails because of, a social write.
 */
import { createHash } from "node:crypto";
import type { Db } from "../db";
import { checkShowText } from "../safety";
import { isTieKind, TIE_KINDS, tieKey, type TieKindDef } from "./kinds";
import { socialTiesOn } from "./switch";
import {
  clampValence,
  EVIDENCE_KEPT,
  type Evidence,
  type Layer,
  type Source,
  type Tie,
  type TieEvent,
  type TieEventRow,
  type TieInput,
  type TieKey,
  type TieKeyInput,
  type TieKindId,
  type TieRefusal,
  type TieStatus,
  type TieWrite,
  type Visibility,
} from "./types";

export { tieKey };

type Env = Record<string, string | undefined>;

/** The longest story and "since" a tie keeps (the columns' checks). */
export const STORY_MAX = 240;
export const SINCE_MAX = 40;

/* --------------------------------------------------- best effort --------------------------------------------------- */

/**
 * Runs a social write from the site: null when SOCIAL_TIES is off, and null (logged) when it throws, so the date, scene
 * or page that called it carries on as before. Every hook outside lib/social/ uses this.
 */
export async function safely<T>(label: string, work: () => Promise<T>, env: Env = process.env): Promise<T | null> {
  if (!socialTiesOn(env)) return null;
  try {
    return await work();
  } catch (err) {
    console.error(`[social] ${label} failed:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/* ------------------------------------------------------ rows ------------------------------------------------------ */

/** The columns a tie is read with (every one: callers that serve a page drop the person columns). */
export const TIE_COLUMNS = `id, from_id, to_id, to_person_id, kind, layer, directed, valence, closeness, status, visibility, source, source_ref,
  evidence, detail, story, since_text, origin_model, prompt_version, confidence, created_by, answered_by, started_at, ended_at,
  last_contact_at, created_at, updated_at`;

/** A tie row as the database returns it. */
export type TieRow = {
  id: string;
  from_id: string;
  to_id: string | null;
  to_person_id: string | null;
  kind: string;
  layer: string;
  directed: boolean;
  valence: number;
  closeness: number;
  status: string;
  visibility: string;
  source: string;
  source_ref: string | null;
  evidence: unknown;
  detail: unknown;
  story: string | null;
  since_text: string | null;
  origin_model: string | null;
  prompt_version: string | null;
  confidence: number;
  created_by: string | null;
  answered_by: string | null;
  started_at: string | Date | null;
  ended_at: string | Date | null;
  last_contact_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

const iso = (v: string | Date | null | undefined): string | null => (v === null || v === undefined ? null : new Date(v).toISOString());
/** closeness and confidence are float4 in the table: 0.3 reads back as 0.30000001, so both sides are compared at 3 places. */
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** A row as a Tie: timestamps as ISO strings, the float columns rounded. */
export function tieFromRow(r: TieRow): Tie {
  return {
    id: r.id,
    from_id: r.from_id,
    to_id: r.to_id,
    to_person_id: r.to_person_id,
    kind: r.kind as TieKindId,
    layer: r.layer as Layer,
    directed: r.directed,
    valence: clampValence(Number(r.valence)),
    closeness: round3(Number(r.closeness)),
    status: r.status as TieStatus,
    visibility: r.visibility as Visibility,
    source: r.source as Source,
    source_ref: r.source_ref,
    evidence: Array.isArray(r.evidence) ? (r.evidence as Evidence[]) : [],
    detail: r.detail && typeof r.detail === "object" && !Array.isArray(r.detail) ? (r.detail as Record<string, unknown>) : {},
    story: r.story,
    since_text: r.since_text,
    origin_model: r.origin_model,
    prompt_version: r.prompt_version,
    confidence: round3(Number(r.confidence)),
    created_by: r.created_by,
    answered_by: r.answered_by,
    started_at: iso(r.started_at),
    ended_at: iso(r.ended_at),
    last_contact_at: iso(r.last_contact_at),
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
  };
}

/** A tie's id: a hash of its key, so the same tie has the same id in every database (and a dataset's ids are stable). */
export function tieIdOf(key: TieKey | TieKeyInput): string {
  const k = "from_id" in key ? key : tieKey(key);
  const to = k.to_id ?? `person:${k.to_person_id}`;
  return `tie_${createHash("sha256").update(`${k.from_id}\u0000${to}\u0000${k.kind}`).digest("hex").slice(0, 32)}`;
}

/** One tie by id, or null. */
export async function getTie(db: Db, id: string): Promise<Tie | null> {
  const r = (await db.query<TieRow>(`select ${TIE_COLUMNS} from social_ties where id = $1`, [id])).rows[0];
  return r && isTieKind(r.kind) ? tieFromRow(r) : null;
}

/** The tie with this key (either order for a symmetric pair), or null. */
export async function findTie(db: Db, input: TieKeyInput): Promise<Tie | null> {
  const k = tieKey(input);
  const r = (
    await db.query<TieRow>(`select ${TIE_COLUMNS} from social_ties where from_id = $1 and coalesce(to_id, to_person_id) = $2 and kind = $3`, [
      k.from_id,
      k.to_id ?? k.to_person_id,
      k.kind,
    ])
  ).rows[0];
  return r && isTieKind(r.kind) ? tieFromRow(r) : null;
}

/** A tie's history, oldest first. */
export async function tieEvents(db: Db, tieId: string): Promise<TieEventRow[]> {
  const { rows } = await db.query<{ id: string | number; tie_id: string; event: string; changes: unknown; source: string | null; source_ref: string | null; actor: string | null; at: string | Date }>(
    `select id, tie_id, event, changes, source, source_ref, actor, at from social_tie_events where tie_id = $1 order by at, id`,
    [tieId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    tie_id: r.tie_id,
    event: r.event as TieEvent,
    changes: (r.changes && typeof r.changes === "object" ? r.changes : {}) as TieEventRow["changes"],
    source: r.source as Source | null,
    source_ref: r.source_ref,
    actor: r.actor,
    at: iso(r.at)!,
  }));
}

/**
 * Deletes a tie and its history. Only for a derived projection whose source was withdrawn (a pair's last public date
 * made private, reported away or deleted): what is no longer on the public record leaves no public trace. Anything
 * else ends (`endTie`) and keeps its history.
 */
export async function removeTie(db: Db, id: string): Promise<boolean> {
  return (await db.query(`delete from social_ties where id = $1 returning id`, [id])).rows.length > 0;
}

/* --------------------------------------------------- the write --------------------------------------------------- */

/** Evidence as stored: the ref and an ISO time. */
const evidenceOf = (e: TieInput["evidence"]): Evidence | null => (e && e.ref ? { ref: e.ref, at: iso(e.at ?? new Date())! } : null);

/** Adds one piece of evidence: each ref once, newest first, at most EVIDENCE_KEPT. `added` is false for a repeat, or one too old to keep. */
export function mergeEvidence(existing: readonly Evidence[], add: Evidence | null): { evidence: Evidence[]; added: boolean } {
  if (!add || existing.some((e) => e.ref === add.ref)) return { evidence: [...existing], added: false };
  const merged = [add, ...existing].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0)).slice(0, EVIDENCE_KEPT);
  const added = merged.some((e) => e.ref === add.ref);
  return { evidence: added ? merged : [...existing], added };
}

/** JSON with its keys sorted, so two values compare equal whatever order jsonb gave their keys in. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** The fields a change is logged for (the person columns never: `actor` says who). */
const TRACKED = [
  "layer", "valence", "closeness", "status", "visibility", "source", "story", "since_text", "origin_model", "prompt_version", "confidence",
  "started_at", "ended_at", "last_contact_at",
] as const satisfies readonly (keyof Tie)[];

/** What changed between two states of a tie, as {field: [from, to]}; a detail key as `detail.<key>`. */
export function tieChanges(before: Tie, after: Tie): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const f of TRACKED) if (stable(before[f]) !== stable(after[f])) out[f] = [before[f] ?? null, after[f] ?? null];
  for (const k of new Set([...Object.keys(before.detail), ...Object.keys(after.detail)])) {
    if (stable(before.detail[k]) !== stable(after.detail[k])) out[`detail.${k}`] = [before.detail[k] ?? null, after.detail[k] ?? null];
  }
  return out;
}

/** What a new tie was created with, as {field: [null, value]}: the `created` event's changes. */
function initialChanges(t: Tie): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const f of TRACKED) if (t[f] !== null && t[f] !== undefined) out[f] = [null, t[f]];
  for (const [k, v] of Object.entries(t.detail)) out[`detail.${k}`] = [null, v];
  return out;
}

/** The event a status move is: a proposal answered, a tie ended or brought back. */
function statusEvent(from: TieStatus, to: TieStatus): TieEvent {
  if (to === "proposed") return "proposed";
  if (from === "proposed" && to === "active") return "accepted";
  if (to === "declined") return "declined";
  if (to === "ended") return "ended";
  if (to === "active" && (from === "ended" || from === "declined")) return "revived";
  return "changed";
}

/** A story or "since" that's too long or fails the show's text check. */
function textRefusal(story: string | null | undefined, since: string | null | undefined): TieRefusal | null {
  const s = story?.trim() ?? "";
  const n = since?.trim() ?? "";
  if (s.length > STORY_MAX || n.length > SINCE_MAX) return "too_long";
  const fields: Record<string, string> = {};
  if (s) fields.story = s;
  if (n) fields.since = n;
  return Object.keys(fields).length && !checkShowText(fields).ok ? "unsafe" : null;
}

const OPEN: readonly TieStatus[] = ["active", "proposed"];

/**
 * Whether a tie may not be active: an `exclusive` kind (one spouse, three best friends) that either character end
 * already holds as many of, counting active and proposed ties other than this one.
 */
async function overExclusive(db: Db, key: TieKey, def: TieKindDef, id: string): Promise<boolean> {
  if (!def.exclusive) return false;
  const ends = [key.from_id, key.to_id].filter((x): x is string => !!x);
  const { rows } = await db.query<{ id: string; n: number }>(
    `select c.id, (select count(*)::int from social_ties t
                    where t.kind = $2 and t.status = any($3) and t.id <> $4 and (t.from_id = c.id or t.to_id = c.id)) as n
       from unnest($1::text[]) as c(id)`,
    [ends, key.kind, OPEN, id],
  );
  return rows.some((r) => r.n >= def.exclusive!);
}

/**
 * Appends one event. Its time is when it happened on the show (the evidence's, or a status move's), else now; never
 * before the tie's last event, so the log reads in order and a replay never sees a contact before its tie was made (a
 * backfill that brings older evidence to a newer tie logs it at the tie's latest moment; the evidence keeps its own time).
 */
async function logEvent(
  db: Db,
  tieId: string,
  event: TieEvent,
  changes: Record<string, [unknown, unknown]>,
  o: { source?: Source | null; ref?: string | null; actor?: string | null; at?: string | null },
): Promise<void> {
  await db.query(
    `insert into social_tie_events (tie_id, event, changes, source, source_ref, actor, at)
     values ($1, $2, $3::jsonb, $4, $5, $6, greatest(coalesce($7::timestamptz, now()), (select max(at) from social_tie_events where tie_id = $1)))`,
    [tieId, event, JSON.stringify(changes), o.source ?? null, o.ref ?? null, o.actor ?? "system", o.at ?? null],
  );
}

type Versioned = TieRow & { v: string };

async function readVersioned(db: Db, key: TieKey): Promise<Versioned | null> {
  return (
    (
      await db.query<Versioned>(`select ${TIE_COLUMNS}, xmin::text as v from social_ties where from_id = $1 and coalesce(to_id, to_person_id) = $2 and kind = $3`, [
        key.from_id,
        key.to_id ?? key.to_person_id,
        key.kind,
      ])
    ).rows[0] ?? null
  );
}

/** Writes a new state over the version it was computed from; false when someone else wrote in between (try again). */
async function writeState(db: Db, t: Tie, version: string): Promise<TieRow | null> {
  const { rows } = await db.query<TieRow>(
    `update social_ties set layer = $3, valence = $4, closeness = $5, status = $6, visibility = $7, source = $8, source_ref = $9, evidence = $10::jsonb,
            detail = $11::jsonb, story = $12, since_text = $13, origin_model = $14, prompt_version = $15, confidence = $16, started_at = $17,
            ended_at = $18, last_contact_at = $19, created_by = $20, answered_by = $21, updated_at = now()
      where id = $1 and xmin::text = $2
      returning ${TIE_COLUMNS}`,
    [
      t.id, version, t.layer, t.valence, t.closeness, t.status, t.visibility, t.source, t.source_ref, JSON.stringify(t.evidence),
      JSON.stringify(t.detail), t.story, t.since_text, t.origin_model, t.prompt_version, t.confidence, t.started_at,
      t.ended_at, t.last_contact_at, t.created_by, t.answered_by,
    ],
  );
  return rows[0] ?? null;
}

/**
 * Creates or updates one tie (PRD section 4: events, then state). Idempotent: the same input twice changes nothing.
 *
 *  - New: inserted with the kind's defaults for whatever isn't given (valence, closeness), `status` active, `visibility`
 *    public; logs `created` (`proposed` for a proposal) with the fields it set.
 *  - Existing: the given fields are set, the rest kept, `detail` merged key by key, the evidence added once; logs the
 *    one event that says what happened (see statusEvent), or `contact` when the only news is new evidence. A derived
 *    write on a declared row adds evidence, contact and detail only.
 *  - Refused: an unknown kind, a tie to oneself, a story that's too long or fails the show's check, or an exclusive
 *    kind (spouse, best friend...) that an end already holds as many of as it may.
 */
export async function upsertTie(db: Db, input: TieInput, env: Env = process.env): Promise<TieWrite> {
  if (!socialTiesOn(env)) return { ok: false, reason: "off" };
  if (!isTieKind(input.kind)) return { ok: false, reason: "unknown_kind" };
  const key = tieKey(input);
  if (key.to_id !== null && key.to_id === key.from_id) return { ok: false, reason: "self" };
  const refusal = textRefusal(input.story, input.since_text);
  if (refusal) return { ok: false, reason: refusal };
  const def = TIE_KINDS[key.kind];
  const add = evidenceOf(input.evidence);
  const actor = input.actor ?? input.created_by ?? "system";
  // A kind's layer is the registry's, except `dated`, whose stage decides it.
  const layer: Layer = key.kind === "dated" && input.layer ? input.layer : def.layer;
  const id = tieIdOf(key);

  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await readVersioned(db, key);
    if (!existing) {
      // An off-screen person is only ever their holder's: a tie to one starts at the character who has them.
      if (key.to_person_id) {
        const holder = (await db.query<{ holder_id: string }>(`select holder_id from social_people where id = $1`, [key.to_person_id])).rows[0]?.holder_id;
        if (holder !== key.from_id) return { ok: false, reason: "not_found" };
      }
      const status = input.status ?? "active";
      if (OPEN.includes(status) && (await overExclusive(db, key, def, id))) return { ok: false, reason: "exclusive" };
      const at = add?.at ?? null;
      const started = input.started_at !== undefined ? iso(input.started_at) : at;
      const ended = input.ended_at !== undefined ? iso(input.ended_at) : status === "ended" ? (at ?? new Date().toISOString()) : null;
      const { rows } = await db.query<TieRow>(
        `insert into social_ties (id, from_id, to_id, to_person_id, kind, layer, directed, valence, closeness, status, visibility, source, source_ref,
                                  evidence, detail, story, since_text, origin_model, prompt_version, confidence, created_by, started_at, ended_at,
                                  last_contact_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16, $17, $18, $19, $20, $21, $22, $23, $24)
         on conflict do nothing
         returning ${TIE_COLUMNS}`,
        [
          id, key.from_id, key.to_id, key.to_person_id, key.kind, layer, def.directed, clampValence(input.valence ?? def.valence),
          round3(clamp01(input.closeness ?? def.closeness)), status, input.visibility ?? "public", input.source, add?.ref ?? null,
          JSON.stringify(add ? [add] : []), JSON.stringify(input.detail ?? {}), input.story?.trim() || null, input.since_text?.trim() || null,
          input.origin_model ?? null, input.prompt_version ?? null, round3(clamp01(input.confidence ?? 1)), input.created_by ?? null,
          started, ended, at,
        ],
      );
      if (!rows[0]) continue; // someone else created it a moment ago: update theirs
      const tie = tieFromRow(rows[0]);
      const event: TieEvent = status === "proposed" ? "proposed" : "created";
      await logEvent(db, tie.id, event, initialChanges(tie), { source: input.source, ref: add?.ref, actor, at: started ?? at });
      return { ok: true, tie, event };
    }

    const before = tieFromRow(existing);
    const next: Tie = { ...before, detail: { ...before.detail, ...(input.detail ?? {}) } };
    // A derived write never rewrites what someone declared: it brings its evidence, its contact and its detail.
    const declaredKept = input.source === "derived" && before.source !== "derived";
    if (!declaredKept) {
      if (input.valence !== undefined) next.valence = clampValence(input.valence);
      if (input.closeness !== undefined) next.closeness = round3(clamp01(input.closeness));
      if (input.status !== undefined) next.status = input.status;
      if (input.visibility !== undefined) next.visibility = input.visibility;
      if (input.story !== undefined) next.story = input.story?.trim() || null;
      if (input.since_text !== undefined) next.since_text = input.since_text?.trim() || null;
      if (input.origin_model !== undefined) next.origin_model = input.origin_model;
      if (input.prompt_version !== undefined) next.prompt_version = input.prompt_version;
      if (input.confidence !== undefined) next.confidence = round3(clamp01(input.confidence));
      if (input.started_at !== undefined) next.started_at = iso(input.started_at);
      if (key.kind === "dated") next.layer = layer;
      // A row someone declares on is theirs from then on (its source and who declared it); the first declarer stays.
      if (before.source === "derived" && input.source !== "derived") {
        next.source = input.source;
        next.created_by = input.created_by ?? null;
      }
    }
    const merged = mergeEvidence(before.evidence, add);
    next.evidence = merged.evidence;
    if (merged.added && add) {
      next.source_ref = merged.evidence[0].ref;
      if (!before.last_contact_at || add.at > before.last_contact_at) next.last_contact_at = add.at;
    }
    if (next.status !== before.status) {
      if (OPEN.includes(next.status) && !OPEN.includes(before.status) && (await overExclusive(db, key, def, before.id))) return { ok: false, reason: "exclusive" };
      if (next.status === "ended" && input.ended_at === undefined) next.ended_at = add?.at ?? new Date().toISOString();
      if (OPEN.includes(next.status) && input.ended_at === undefined) next.ended_at = null;
    }
    if (!declaredKept && input.ended_at !== undefined) next.ended_at = iso(input.ended_at);

    const changes = tieChanges(before, next);
    const onlyContact = Object.keys(changes).every((f) => f === "last_contact_at");
    if (!Object.keys(changes).length && !merged.added) return { ok: true, tie: before, event: null };
    const event: TieEvent = onlyContact ? "contact" : next.status !== before.status ? statusEvent(before.status, next.status) : "changed";
    const written = await writeState(db, next, existing.v);
    if (!written) continue; // written by someone else in between: read again and redo
    const tie = tieFromRow(written);
    await logEvent(db, tie.id, event, changes, { source: input.source, ref: add?.ref, actor, at: add?.at });
    return { ok: true, tie, event };
  }
  throw new Error(`social: tie ${id} kept changing under the write`);
}

/* ------------------------------------------------ status and contact ------------------------------------------------ */

/** Who moved a tie's status, and on what. `answeredBy`: the other owner who said yes or no to a proposal (null: it lapsed). */
export type StatusOptions = { actor?: string; source?: Source; ref?: string; at?: string | Date; answeredBy?: string | null };

/**
 * Moves a tie's status (proposals, mostly: Phase 2b) and logs what it was: `proposed`, `accepted` (proposed to active),
 * `declined` (a no, or a proposal that lapsed: `answeredBy` null), `ended`, `revived`. The same status again is a no-op.
 * Reviving an exclusive kind is refused while an end holds as many as it may.
 */
export async function setStatus(db: Db, tieId: string, status: TieStatus, o: StatusOptions = {}, env: Env = process.env): Promise<TieWrite> {
  if (!socialTiesOn(env)) return { ok: false, reason: "off" };
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = (await db.query<Versioned>(`select ${TIE_COLUMNS}, xmin::text as v from social_ties where id = $1`, [tieId])).rows[0];
    if (!existing || !isTieKind(existing.kind)) return { ok: false, reason: "not_found" };
    const before = tieFromRow(existing);
    if (before.status === status) return { ok: true, tie: before, event: null };
    const key: TieKey = { from_id: before.from_id, to_id: before.to_id, to_person_id: before.to_person_id, kind: before.kind };
    if (OPEN.includes(status) && !OPEN.includes(before.status) && (await overExclusive(db, key, TIE_KINDS[before.kind], before.id))) return { ok: false, reason: "exclusive" };
    const at = iso(o.at ?? new Date())!;
    const next: Tie = { ...before, status };
    if (status === "ended") next.ended_at = at;
    if (OPEN.includes(status)) next.ended_at = null;
    const event = statusEvent(before.status, status);
    if (before.status === "proposed" && (status === "active" || status === "declined") && o.answeredBy !== undefined) next.answered_by = o.answeredBy;
    const written = await writeState(db, next, existing.v);
    if (!written) continue;
    const tie = tieFromRow(written);
    await logEvent(db, tie.id, event, tieChanges(before, tie), { source: o.source ?? null, ref: o.ref, actor: o.actor ?? o.answeredBy ?? "system", at });
    return { ok: true, tie, event };
  }
  throw new Error(`social: tie ${tieId} kept changing under the write`);
}

/** Ends a tie (they broke up, fell out, the feud cleared): it stays, with its history, as `ended`. */
export const endTie = (db: Db, tieId: string, o: StatusOptions = {}, env: Env = process.env): Promise<TieWrite> => setStatus(db, tieId, "ended", o, env);

/** Brings an ended or declined tie back (`revived`). */
export const reviveTie = (db: Db, tieId: string, o: StatusOptions = {}, env: Env = process.env): Promise<TieWrite> => setStatus(db, tieId, "active", o, env);

/**
 * Records one aired contact on a tie that already exists (a date, a scene together, a told line): the evidence once,
 * `last_contact_at` moved forward, a `contact` event. `closeness`, when given, is set too (Phase 4's dynamics work it
 * out). The same ref twice is a no-op.
 */
export async function logContact(
  db: Db,
  tieId: string,
  contact: { ref: string; at?: string | Date; source?: Source; actor?: string; closeness?: number },
  env: Env = process.env,
): Promise<TieWrite> {
  if (!socialTiesOn(env)) return { ok: false, reason: "off" };
  const add = evidenceOf({ ref: contact.ref, at: contact.at });
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = (await db.query<Versioned>(`select ${TIE_COLUMNS}, xmin::text as v from social_ties where id = $1`, [tieId])).rows[0];
    if (!existing || !isTieKind(existing.kind)) return { ok: false, reason: "not_found" };
    const before = tieFromRow(existing);
    const merged = mergeEvidence(before.evidence, add);
    if (!merged.added || !add) return { ok: true, tie: before, event: null };
    const next: Tie = { ...before, evidence: merged.evidence, source_ref: merged.evidence[0].ref };
    if (!before.last_contact_at || add.at > before.last_contact_at) next.last_contact_at = add.at;
    if (contact.closeness !== undefined) next.closeness = round3(clamp01(contact.closeness));
    const written = await writeState(db, next, existing.v);
    if (!written) continue;
    const tie = tieFromRow(written);
    await logEvent(db, tie.id, "contact", tieChanges(before, tie), { source: contact.source ?? null, ref: add.ref, actor: contact.actor, at: add.at });
    return { ok: true, tie, event: "contact" };
  }
  throw new Error(`social: tie ${tieId} kept changing under the write`);
}
