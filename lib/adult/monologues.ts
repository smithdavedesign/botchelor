/**
 * Two sides of the night (David, 2026-10-22, the third show feature from the competitor read): for a whole saved night,
 * each character's inner monologue of the same night (a page each, in their own voice, from their sheet, their voice
 * kit, the night's own lines and what they remembered going into it), and the two texts they send the morning after,
 * which disagree.
 *
 *  - Written once, on After Dark's text model (adultModel: OpenRouter, held to the hosts whose terms allow it), and kept
 *    (adult_monologues, one row a night): every later read is free.
 *  - Every word is held to the two lines (checkAdultText: nobody under 18 or anything that suggests it, no family,
 *    teacher/student, school or age-play, no real people). A reply that crosses one is asked for once more; a second one
 *    that does is refused, and nothing is kept or counted.
 *  - Who reads it: an owner, for their own whole nights; an entitled viewer, for a published Short once they've pressed
 *    play (lib/adult/shorts.ts). Its owner and admins see a Short's without pressing play.
 *  - Included in the subscription, with a monthly cap (`monologues`, lib/adult/usage.ts; admins uncapped): writing one
 *    counts, reading one that's written doesn't.
 *  - What they remember is what they remembered then: the facts and the PG note from up to the night's end, never a later
 *    night's. The prompt never carries a line's private notes (its why, memory or facts).
 */
import { approvedPortraitId } from "../assets";
import type { Character } from "../character";
import type { Db } from "../db";
import type { ChatMessage, Usage } from "../model";
import { checkAdultText } from "../safety";
import { eligiblePair } from "./scenes";
import { jsonOf, loadPairFacts } from "./facts";
import { adultModel } from "./mode";
import { writerChoice } from "./writer";
import { hasWatched, pairNights, shortLines, type NightGroup, type NightRow } from "./shorts";
import { STAGES } from "./stages";
import { countUse, overCap, usageLeft } from "./usage";
import { sceneCharacter, voiceKitLines } from "./voice";
import { isAdmin } from "../admins";

/** A page: long enough to be one, short enough to read beside the other. */
export const PAGE_MIN = 300;
export const PAGE_MAX = 4000;
/** A morning-after text. */
export const TEXT_MAX = 280;
/** The night's lines in the prompt at most: a longer night gives its recap and its last lines. */
export const LINES_IN_PROMPT = 160;
const REPLY_TOKENS = 2400;
/** Facts or notes from this long after the night's last chapter was filed still belong to it (they're kept at the close). */
const MEMORY_GRACE_MS = 10 * 60 * 1000;

export type Side = { page: string; text: string };
export type TwoSides = {
  night_id: string;
  a: Side & { id: string; name: string; label: string; portrait?: string | null };
  b: Side & { id: string; name: string; label: string; portrait?: string | null };
  created_at: string;
};

/** "Her side", "His side" or "Their side", from how they're referred to (lib/character.ts pronouns). */
export function sideLabel(pronouns: string | null | undefined): string {
  const p = (pronouns ?? "").trim().toLowerCase();
  if (/^she\b/.test(p)) return "Her side";
  if (/^he\b/.test(p)) return "His side";
  return "Their side";
}

const firstName = (name: string) => name.split(/\s+/)[0] ?? name;

/** The sheet as a page writer needs it: who they are, how they talk (their voice kit), never their private facts. */
function sheetLines(c: Character): string {
  return [
    `${c.name}, ${c.age}${c.pronouns ? `, ${c.pronouns}` : ""}. ${c.bio}`,
    c.persona.traits.length ? `Traits: ${c.persona.traits.join(", ")}` : "",
    c.persona.want ? `What they want in someone: ${c.persona.want}` : "",
    c.voice ? `How they talk: ${c.voice}` : "",
    ...voiceKitLines(c),
  ]
    .filter(Boolean)
    .join("\n");
}

export type SidesInput = {
  a: Character;
  b: Character;
  /** The night's lines (who and what only). */
  lines: readonly { who: "a" | "b"; text: string }[];
  /** The recap of the night so far, for a night longer than LINES_IN_PROMPT. */
  recap: string | null;
  /** What each remembered of the other going into the night. */
  memories: { a: readonly string[]; b: readonly string[] };
  /** Where it began (their date's place) and where it ended, and how far it went. */
  began: string | null;
  ended: string | null;
  furthest: number;
};

/** The prompt: both sheets, what each remembered, the night itself, and what to write. */
export function sidesMessages(input: SidesInput, retryNote: string | null = null): ChatMessage[] {
  const { a, b } = input;
  const name = (who: "a" | "b") => firstName(who === "a" ? a.name : b.name);
  const shown = input.lines.slice(-LINES_IN_PROMPT);
  const cut = input.lines.length > shown.length;
  const memory = (who: "a" | "b") => {
    const items = input.memories[who];
    return items.length ? `What ${name(who)} remembered about ${name(who === "a" ? "b" : "a")} going into the night:\n${items.map((m) => `- ${m}`).join("\n")}` : "";
  };
  const user = [
    `The night between ${a.name} and ${b.name}${input.began ? `, from ${input.began}` : ""}${input.ended ? ` to ${input.ended}` : ""}. It went as far as ${STAGES[input.furthest] ?? STAGES[0]}.`,
    `${name("a")}'s sheet:\n${sheetLines(a)}`,
    memory("a"),
    `${name("b")}'s sheet:\n${sheetLines(b)}`,
    memory("b"),
    cut && input.recap ? `How the night began (a recap of the earlier part):\n${input.recap}` : "",
    `The night${cut ? ", its last part" : ""}, line by line:\n${shown.map((l) => `${name(l.who)}: ${l.text}`).join("\n")}`,
    [
      "Write two things.",
      `1. Each one's side of this night: a page each (about 250 to 350 words), in the first person, in their own voice: how they think, not how they talk out loud. What they noticed, wanted, worried about or misread, and what they think the other one felt. The same night from two sides: neither knows what the other thought, and the gap between the two pages is the point. Stay true to the lines (nothing happens that didn't), and never more explicit than the night was.`,
      `2. The morning after: one short text from each to the other (under 200 characters each), in their own voice. The two disagree about something real from the night: what it meant, who started it, or what happens next.`,
      `Never put a number word straight after "was", "is", "were", "turned" or "looked" ("my flat was two floors down", "it was one of those nights"): the age check reads that as someone's age. Say it another way ("two floors down", "one of those nights").`,
      `Reply with a JSON object only: {"a": {"side": "...", "text": "..."}, "b": {"side": "...", "text": "..."}}, where "a" is ${name("a")} and "b" is ${name("b")}.`,
    ].join("\n"),
    retryNote ? `Your last reply couldn't be used: ${retryNote}. Write it again.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return [
    {
      role: "system",
      content:
        "You write for After Dark, the private adult side of a dating show: fiction about two consenting adults, both well over 18, with no real people in it. " +
        "Never anyone under 18 or anything that suggests it, no family or step-family, no teacher and student, no school, no age-play, nothing non-consensual.",
    },
    { role: "user", content: user },
  ];
}

const text = (v: unknown): string => (typeof v === "string" ? v.replace(/[ \t]+\n/g, "\n").trim() : "");

/** A reply's key as the parser compares it: no wrapping underscores, lower case (DeepSeek wraps keys: "_stage", "_place"). */
const keyOf = (k: string) => k.replace(/^_+|_+$/g, "").toLowerCase();
function field(o: unknown, names: readonly string[]): unknown {
  if (!o || typeof o !== "object" || Array.isArray(o)) return undefined;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (names.includes(keyOf(k))) return v;
  return undefined;
}
const PAGE_KEYS = ["side", "page", "monologue", "inner_monologue"];
const TEXT_KEYS = ["text", "morning_text", "morning_after", "message"];

/**
 * The two sides in a reply, or why it can't be used. The shape asked for is {"a": {"side", "text"}, "b": …}; the near
 * ones models send are read too: keys wrapped in underscores, "page" or "monologue" for "side", the flattened "a_side" /
 * "a_text", a wrapper object ("sides"), and the characters' first names in place of "a" and "b".
 */
export function parseSides(raw: string, names: { a?: string; b?: string } = {}): { a: Side; b: Side } | { reason: string } {
  let j = jsonOf(raw) as Record<string, unknown> | null;
  if (!j || typeof j !== "object" || Array.isArray(j)) return { reason: "no JSON object in it" };
  const inner = field(j, ["sides", "result", "output"]);
  if (inner && typeof inner === "object" && !Array.isArray(inner)) j = inner as Record<string, unknown>;
  const side = (who: "a" | "b"): Side => {
    const keys = [who, ...(names[who] ? [names[who]!.split(/\s+/)[0].toLowerCase()] : [])];
    const o = field(j, keys);
    return {
      page: text(field(o, PAGE_KEYS) ?? field(j, PAGE_KEYS.map((k) => `${who}_${k}`)) ?? field(j, PAGE_KEYS.map((k) => `${k}_${who}`))),
      text: text(field(o, TEXT_KEYS) ?? field(j, TEXT_KEYS.map((k) => `${who}_${k}`)) ?? field(j, TEXT_KEYS.map((k) => `${k}_${who}`))),
    };
  };
  const a = side("a");
  const b = side("b");
  for (const [who, s] of [["a", a], ["b", b]] as const) {
    if (s.page.length < PAGE_MIN) return { reason: `${who}'s page is missing or too short` };
    if (s.page.length > PAGE_MAX) return { reason: `${who}'s page is too long` };
    if (!s.text) return { reason: `${who}'s morning text is missing` };
    if (s.text.length > TEXT_MAX) return { reason: `${who}'s morning text is over ${TEXT_MAX} characters` };
  }
  if (a.text.toLowerCase() === b.text.toLowerCase()) return { reason: "the two morning texts are the same" };
  return { a, b };
}

/** Null when every word holds to the two lines; otherwise what crossed (never the words themselves). */
export function crossesLines(s: { a: Side; b: Side }): string | null {
  const r = checkAdultText({ a_side: s.a.page, a_text: s.a.text, b_side: s.b.page, b_text: s.b.text });
  return r.ok ? null : `a passage crossed one of the lines that never move (${r.field}: ${r.reason})`;
}

/**
 * The two sides held to the lines that never move, the way a scene's lines are: on a page, a sentence that crosses one
 * is cut (After Dark reads any number word after "was" or "is" as an age, so "my flat was two floors down" goes too) and
 * the page that's left must pass whole and still be a page; a morning text that crosses fails it. Never the words of
 * what was cut, only how many sentences.
 */
export function holdSides(s: { a: Side; b: Side }): { sides: { a: Side; b: Side }; cut: number } | { reason: string } {
  let cut = 0;
  const hold = (page: string, field: string): string =>
    page
      .split(/\n{2,}/)
      .map((para) =>
        para
          .split(/(?<=[.!?…])\s+/)
          .filter((sentence) => {
            const ok = checkAdultText({ [field]: sentence }).ok;
            if (!ok) cut++;
            return ok;
          })
          .join(" ")
          .trim(),
      )
      .filter(Boolean)
      .join("\n\n");
  const sides = { a: { ...s.a, page: hold(s.a.page, "a_side") }, b: { ...s.b, page: hold(s.b.page, "b_side") } };
  for (const who of ["a", "b"] as const) if (sides[who].page.length < PAGE_MIN) return { reason: `${who}'s page crossed the lines in too many places` };
  const whole = crossesLines(sides);
  return whole ? { reason: whole } : { sides, cut };
}

type CacheRow = { night_id: string; character_a: string; character_b: string; a_page: string; a_text: string; b_page: string; b_text: string; created_at: string | Date };

async function cached(db: Db, nightId: string): Promise<CacheRow | null> {
  return (
    (await db.query<CacheRow>(`select night_id, character_a, character_b, a_page, a_text, b_page, b_text, created_at from adult_monologues where night_id = $1`, [nightId])).rows[0] ??
    null
  );
}

async function asSides(db: Db, r: CacheRow): Promise<TwoSides> {
  const people = (await db.query<{ id: string; name: string; pronouns: string | null }>(`select id, name, pronouns from characters where id = any($1)`, [[r.character_a, r.character_b]])).rows;
  const who = (id: string) => people.find((p) => p.id === id);
  // Their show portraits (lib/assets.ts), for the header beside each page.
  const portraits = new Map(await Promise.all([r.character_a, r.character_b].map(async (id) => [id, await approvedPortraitId(db, id)] as const)));
  const portrait = (id: string) => (portraits.get(id) ? `/api/assets/${portraits.get(id)}` : null);
  return {
    night_id: r.night_id,
    a: { id: r.character_a, name: who(r.character_a)?.name ?? r.character_a, label: sideLabel(who(r.character_a)?.pronouns), portrait: portrait(r.character_a), page: r.a_page, text: r.a_text },
    b: { id: r.character_b, name: who(r.character_b)?.name ?? r.character_b, label: sideLabel(who(r.character_b)?.pronouns), portrait: portrait(r.character_b), page: r.b_page, text: r.b_text },
    created_at: new Date(r.created_at).toISOString(),
  };
}

/**
 * What each remembered of the other going into the night: their facts (lib/adult/facts.ts) and their PG note, as they
 * stood when the night's last chapter was filed. Anything kept later belongs to a later night.
 */
async function memoriesAsOf(db: Db, ownerId: string, a: Character, b: Character, until: Date): Promise<{ a: string[]; b: string[] }> {
  const cutoff = until.getTime() + MEMORY_GRACE_MS;
  const facts = (await loadPairFacts(db, ownerId, a.id, b.id)).filter((f) => new Date(f.created_at).getTime() <= cutoff);
  const notes = (
    await db
      .query<{ character_id: string; note: string; updated_at: string | Date }>(
        `select character_id, note, updated_at from adult_memories where owner_id = $1 and ((character_id = $2 and other_id = $3) or (character_id = $3 and other_id = $2))`,
        [ownerId, a.id, b.id],
      )
      .catch(() => ({ rows: [] as { character_id: string; note: string; updated_at: string | Date }[] }))
  ).rows.filter((n) => new Date(n.updated_at).getTime() <= cutoff);
  const of = (id: string) => [...notes.filter((n) => n.character_id === id).map((n) => n.note), ...facts.filter((f) => f.character_id === id).slice(-8).map((f) => f.fact)];
  return { a: of(a.id), b: of(b.id) };
}

/** The whole night's input for the prompt: its lines (who and what), its recap, where it began and ended, how far. */
function nightInput(rows: readonly NightRow[]): Pick<SidesInput, "lines" | "recap" | "began" | "ended" | "furthest"> {
  const lines = rows.flatMap((r) => (r.lines ?? []).map((l) => ({ who: l.who, text: l.text })));
  const last = rows.at(-1);
  const stops = [...rows].reverse().find((r) => (r.place_history ?? []).length)?.place_history ?? [];
  return {
    lines,
    recap: last?.recap ?? null,
    began: rows[0]?.date_setting ?? stops[0]?.place ?? null,
    ended: stops.at(-1)?.set ?? stops.at(-1)?.place ?? last?.set_place ?? last?.place ?? null,
    furthest: Math.max(0, ...rows.flatMap((r) => [(r.stage ?? 0), ...(r.lines ?? []).map((l) => (typeof l.stage === "number" ? l.stage : 0))])),
  };
}

export type SidesResult = { ok: true; sides: TwoSides; written: boolean } | { ok: false; status: number; error: string; message: string };
const refuse = (status: number, error: string, message: string): SidesResult => ({ ok: false, status, error, message });

/**
 * The night's two sides: kept ones at once, else written now (counted against the requester's month), on After Dark's
 * model, held to the two lines, asked again once when a reply can't be used. `owner` is whose night it is (whose memory
 * it reads); `requester` is who asked (whose cap it counts against).
 */
async function sidesOf(db: Db, requester: string, owner: string, pair: [string, string], nightId: string, rows: readonly NightRow[], until: Date): Promise<SidesResult> {
  const kept = await cached(db, nightId);
  if (kept) return { ok: true, sides: await asSides(db, kept), written: false };
  const capped = await overCap(db, requester, "monologues");
  if (capped) return refuse(429, "capped", capped);
  const [a, b] = await Promise.all([sceneCharacter(db, pair[0]), sceneCharacter(db, pair[1])]);
  if (!a || !b) return refuse(404, "not_found", "One of them is gone.");
  const input: SidesInput = { a, b, ...nightInput(rows), memories: await memoriesAsOf(db, owner, a, b, until) };
  // Written by the night's owner's own writer (lib/adult/writer.ts), like their scenes, with room for its thinking.
  const writer = await writerChoice(db, owner);
  const model = await adultModel(db, process.env, { model: writer.id });
  let note: string | null = null;
  let got: { a: Side; b: Side } | null = null;
  let cost = 0;
  for (let attempt = 0; attempt < 2 && !got; attempt++) {
    let raw: string;
    try {
      raw = await model.complete(sidesMessages(input, note), { temperature: 0.8, maxTokens: REPLY_TOKENS + writer.think_tokens, onUsage: (u: Usage) => (cost += u.cost ?? 0) });
    } catch (err) {
      console.warn(`[after-dark] two sides of night ${nightId}: the model didn't answer (${err instanceof Error ? err.message.slice(0, 160) : "error"})`);
      return refuse(502, "model_error", "The writer didn't answer. Try again in a minute.");
    }
    const parsed = parseSides(raw, { a: a.name, b: b.name });
    const held = "reason" in parsed ? parsed : holdSides(parsed);
    // Why a reply was refused goes in the log and the retry's note, never its words.
    if ("reason" in held) {
      console.warn(`[after-dark] two sides of night ${nightId}, attempt ${attempt + 1}: ${held.reason}`);
      note = held.reason;
      continue;
    }
    if (held.cut) console.warn(`[after-dark] two sides of night ${nightId}: ${held.cut} sentence(s) cut at the lines that never move`);
    got = held.sides;
  }
  if (!got) return refuse(422, "refused", "Both sides couldn't be written within the lines that never move. Try again.");
  const { rows: stored } = await db.query<CacheRow>(
    `insert into adult_monologues (night_id, owner_id, character_a, character_b, a_page, a_text, b_page, b_text, created_by, cost_usd)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (night_id) do nothing
     returning night_id, character_a, character_b, a_page, a_text, b_page, b_text, created_at`,
    [nightId, owner, pair[0], pair[1], got.a.page, got.a.text, got.b.page, got.b.text, requester, cost || null],
  );
  // Two asked at once: the first one kept is everyone's, and only the one that kept it is counted.
  if (!stored[0]) {
    const other = await cached(db, nightId);
    return other ? { ok: true, sides: await asSides(db, other), written: false } : refuse(500, "not_kept", "That didn't save. Try again.");
  }
  await countUse(db, requester, "monologues");
  return { ok: true, sides: await asSides(db, stored[0]), written: true };
}

/** A whole night of the owner's own (any of its chapters names it), in their After Dark. */
async function ownNight(db: Db, owner: string, nightId: string): Promise<{ group: NightGroup; pair: [string, string] } | SidesResult> {
  const row = (await db.query<{ character_a: string; character_b: string }>(`select character_a, character_b from adult_nights where id = $1 and owner_id = $2`, [nightId, owner])).rows[0];
  const pair = row ? await eligiblePair(db, owner, row.character_a, row.character_b) : null;
  if (!row || !pair) return refuse(404, "not_found", "That isn't one of your saved nights.");
  const group = (await pairNights(db, owner, pair)).find((g) => g.rows.some((r) => r.id === nightId));
  if (!group) return refuse(404, "not_found", "That isn't one of your saved nights.");
  if (!group.complete) return refuse(409, "night_running", "This night is still going. Start over files it as a whole night; then both sides can be written.");
  return { group, pair };
}

/** The two sides of one of the owner's own whole nights: kept, or written now. */
export async function sidesForNight(db: Db, owner: string, nightId: string): Promise<SidesResult> {
  const own = await ownNight(db, owner, nightId);
  if ("ok" in own) return own;
  return sidesOf(db, owner, owner, own.pair, own.group.id, own.group.rows, own.group.until);
}

type ShortNight = NonNullable<Awaited<ReturnType<typeof shortLines>>>;

/**
 * A Short whose night this viewer may read: published (or theirs, or any for an admin), and pressed play on (its owner
 * and admins without). Taken down, it's gone for every viewer, written sides and all.
 */
async function readableShort(db: Db, viewer: string, shortId: string): Promise<{ ok: true; s: ShortNight } | { ok: false; status: number; error: string; message: string }> {
  const s = await shortLines(db, shortId);
  const published = s ? (await db.query<{ published: boolean }>(`select published_at is not null as published from adult_shorts where id = $1`, [shortId])).rows[0]?.published : false;
  const privileged = Boolean(s) && (s!.short.owner_id === viewer || (await isAdmin(db, viewer)));
  if (!s || !s.rows.length || (!published && !privileged)) return { ok: false, status: 404, error: "not_found", message: "No Short with that id." };
  if (!privileged && !(await hasWatched(db, viewer, shortId))) return { ok: false, status: 409, error: "not_watched", message: "Press play first: both sides tell how the night goes." };
  return { ok: true, s };
}

/**
 * A Short's two sides, for an entitled viewer who has pressed play on it (its owner and admins without): kept, or written
 * now against the viewer's month. Shares the night's cache with its owner.
 */
export async function sidesForShort(db: Db, viewer: string, shortId: string): Promise<SidesResult> {
  const r = await readableShort(db, viewer, shortId);
  if (!r.ok) return r;
  const { s } = r;
  const until = new Date(s.rows.at(-1)!.created_at);
  return sidesOf(db, viewer, s.short.owner_id, [s.short.character_a, s.short.character_b], s.rows[0].id, s.rows, until);
}

/** The kept two sides of a Short, or null (none yet, or not this viewer's to read): nothing is written. */
export async function keptSidesForShort(db: Db, viewer: string, shortId: string): Promise<TwoSides | null> {
  const r = await readableShort(db, viewer, shortId);
  if (!r.ok) return null;
  const kept = await cached(db, r.s.rows[0].id);
  return kept ? asSides(db, kept) : null;
}

/** For the owner's panel on a pair's page: their whole nights, which have both sides kept, and how many they can write. */
export type SidesNight = { id: string; chapters: number; lines: number; filed_at: string; complete: boolean; written: boolean };
export async function sidesPanel(db: Db, owner: string, x: string, y: string): Promise<{ nights: SidesNight[]; left: number | null } | null> {
  const pair = await eligiblePair(db, owner, x, y);
  if (!pair) return null;
  const groups = await pairNights(db, owner, pair);
  const kept = new Set(
    (await db.query<{ night_id: string }>(`select night_id from adult_monologues where night_id = any($1)`, [groups.map((g) => g.id)])).rows.map((r) => r.night_id),
  );
  return {
    nights: [...groups].reverse().map((g) => ({
      id: g.id,
      chapters: g.rows.length,
      lines: g.rows.reduce((n, r) => n + (r.lines?.length ?? 0), 0),
      filed_at: g.until.toISOString(),
      complete: g.complete,
      written: kept.has(g.id),
    })),
    left: await usageLeft(db, owner, "monologues"),
  };
}

/** The kept two sides of one of the owner's nights, or null: nothing is written. */
export async function keptSidesForNight(db: Db, owner: string, nightId: string): Promise<TwoSides | null> {
  const own = await ownNight(db, owner, nightId);
  if ("ok" in own) return null;
  const kept = await cached(db, own.group.id);
  return kept ? asSides(db, kept) : null;
}
