/**
 * A scene picture's brief (David, 2026-10-29: "the copy or story doesn't give a full picture. We probably want to add a
 * quick call to a llm to summarize the scene, location, what's happening … it's important to know what they're wearing
 * if there is a cosplay ongoing"). The last lines' actions and their usual outfits miss most of a moment: a costume put
 * on twenty lines back, the shirt that came off, the kitchen counter they moved to. So one short call on the fast writer
 * (FALLBACK_WRITER) reads the chapter up to the picture's line and says, plainly and as fact for a photograph, where they
 * are, what each has on at that line, what's still on once they're undressed, what's happening and the mood.
 *
 * It's the night's guess in the picture's form (lib/adult/beats.ts planBeat) in place of the one from the last lines'
 * actions, for every scene picture: one asked for, one drawn ahead, the chapter's own and its close's. The owner's
 * changes still replace it, field by field. Kept per moment (adult_picture_briefs, keyed by what it read), so the form
 * shows what's then sent and a redraw reads the same; the lines changing (a rewind, a redo) reads it again.
 *
 * Fail-open: no OpenRouter key, a timeout, an error or a reply it can't read, and the old guess stands; a field that
 * crosses one of David's lines or the pair's limits is that field's old guess. Free to the viewer (about 0.1¢ a picture).
 */
import { createHash } from "node:crypto";
import type { Db } from "../db";
import type { Model } from "../model";
import { adultModel } from "./mode";
import { adultKeys } from "./settings";
import { FALLBACK_WRITER } from "./writer-config";

/** The call's hard time limit: a picture's form waits on it, and past it the old guess is used. */
export const BRIEF_TIMEOUT_MS = 10_000;
/** The reply's ceiling: five short fields. */
const BRIEF_REPLY_TOKENS = 450;
/** The most of a chapter it reads, from its end (a chapter is at most 120 lines). */
const BRIEF_LINES = 120;
/** Each field's longest, so the picture's prompt keeps room for the moment itself (reels.ts fitPrompt). */
const MAX = { place: 220, wearing: 300, kept_on: 160, happening: 300, mood: 140 } as const;

/** What the brief says: the form's four fields, and what's still on once they're undressed ("" for nothing). */
export type Brief = { place: string; wearing: string; kept_on: string; happening: string; mood: string };

export type BriefInput = {
  owner: string;
  scene: string;
  night: string | null;
  chapter: number;
  /** The chapter's lines up to and including the picture's line, oldest first. */
  lines: readonly { who: "a" | "b"; text: string }[];
  names: { a: string; b: string };
  pronouns: { a: string | null; b: string | null };
  /** What each usually wears (their looks), by name; null when neither has an outfit picked. */
  usual: string | null;
  /** Where the night is, and what the place puts them in. */
  place: string;
  /** The chapter's roleplay, its premise and who plays whom, by name; null for none. */
  roleplay: string | null;
  /** How far the night has gone at the line, in a few words (beats.ts wearingAt). */
  dressed: string;
  /** What the picture shows (beats.ts beatLabel): "Sex: on top", "Undressing", "This chapter". */
  shows: string;
};

const SYSTEM = [
  "You read a private, adults-only scene between two consenting adults and describe one moment of it for a photographer who will take a single photograph of it. You say what is true at that moment, plainly, as facts.",
  "Only what the lines say or plainly imply. Add nothing: no new act, no one else in the picture, nothing more explicit than the lines are. Both of them are adults. Never write anything that makes either of them seem under 18.",
  'Reply with JSON only, nothing else: {"place": "...", "wearing": "...", "kept_on": "...", "happening": "...", "mood": "..."}',
].join("\n");

/** The call's two messages: the rules, then the night as it stands and the chapter up to the moment. Pure. */
export function briefMessages(input: BriefInput): { role: "system" | "user"; content: string }[] {
  const name = (who: "a" | "b") => input.names[who].split(/\s+/)[0];
  const who = (w: "a" | "b") => `${input.names[w]}${input.pronouns[w] ? ` (${input.pronouns[w]})` : ""}`;
  const lines = input.lines.slice(-BRIEF_LINES);
  const last = lines.length;
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: [
        `The two of them: ${who("a")} and ${who("b")}.`,
        ...(input.usual ? [`What each usually wears: ${input.usual}.`] : []),
        `Where the night is: ${input.place || "not said"}.`,
        ...(input.roleplay ? [`This chapter's roleplay: ${input.roleplay}`] : []),
        `How far it has gone by the moment: ${input.dressed}.`,
        `The photograph shows: ${input.shows}.`,
        "",
        `The chapter so far, oldest first. The last line, ${last}, is the moment:`,
        ...lines.map((l, i) => `${i + 1}. ${name(l.who)}: ${l.text}`),
        "",
        "Write each field about the moment, line " + last + ":",
        "- place: where they are at that moment and what's around them that the photograph should show, in one sentence (where they've moved to, if they've moved), without their names (her flat, his kitchen).",
        "- wearing: what each of them has on at that moment, by name, as the lines have it: a costume or outfit put on for a roleplay or a cosplay, exactly (its pieces, its colours), what has come off and what is still on. Their usual clothes only where the lines say nothing else.",
        '- kept_on: once they are undressed, the pieces still on at that moment, by name (a costume piece, stockings, a necklace); "" when nothing is, or they aren\'t undressed.',
        "- happening: the moment itself, concrete and physical: where each of them is, their bodies and hands, what each is doing, in one or two sentences.",
        "- mood: a few words: the feeling between them, and the roles they're playing if it's a roleplay.",
      ].join("\n"),
    },
  ];
}

/** The reply's fields, each trimmed and held to its length; null when it isn't the JSON asked for. Pure. */
export function parseBrief(raw: string): Brief | null {
  try {
    const o = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const field = (k: keyof Brief) => (typeof o[k] === "string" ? (o[k] as string).trim().replace(/\s+/g, " ").slice(0, MAX[k]) : "");
    const b: Brief = { place: field("place"), wearing: field("wearing"), kept_on: field("kept_on"), happening: field("happening"), mood: field("mood") };
    // "none", "nothing", "n/a": nothing kept on.
    if (/^(?:none|nothing|n\/?a|-|"")\.?$/i.test(b.kept_on)) b.kept_on = "";
    return b.wearing || b.happening ? b : null;
  } catch {
    return null;
  }
}

/** The brief's fields that may be used: one that crosses a line (`ok` false) is "" (that field's old guess stands). Pure. */
export function holdBrief(b: Brief, ok: (words: string) => boolean): Brief {
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v && ok(v) ? v : ""])) as Brief;
}

let testBrief: Model | null | undefined;
/** A scripted model for the brief (tests); null turns it off. Unset, it runs only with After Dark's OpenRouter key. */
export function setBriefModelForTests(model: Model | null | undefined): void {
  testBrief = model;
}

/** Who writes the brief: the fast writer on OpenRouter (tests start with none: tests/setup-no-live-checks.ts). */
async function briefModel(db: Db): Promise<Model | null> {
  if (testBrief !== undefined) return testBrief;
  const { openrouter } = await adultKeys(db).catch(() => ({ openrouter: null }));
  return openrouter ? adultModel(db, process.env, { model: FALLBACK_WRITER, timeoutMs: BRIEF_TIMEOUT_MS, retryDelaysMs: [] }) : null;
}

/** What a brief is kept by: everything it read, so the same moment reads the same, and changed lines read again. */
const keyOf = (input: BriefInput) =>
  createHash("sha256")
    .update(JSON.stringify([input.owner, input.scene, input.night, input.chapter, input.lines.slice(-BRIEF_LINES), input.usual, input.place, input.roleplay, input.dressed, input.shows]))
    .digest("hex")
    .slice(0, 40);

/**
 * The moment's brief: the one kept for it, else read now (and kept, the first one kept winning when two read at once).
 * Null when it can't be read (no model, a timeout, an error, a reply it can't use); its fields held to `ok`.
 */
export async function pictureBrief(db: Db, input: BriefInput, ok: (words: string) => boolean): Promise<Brief | null> {
  if (!input.lines.length) return null;
  const key = keyOf(input);
  const kept = (await db.query<{ brief: Brief }>(`select brief from adult_picture_briefs where key = $1 and owner_id = $2`, [key, input.owner])).rows[0];
  if (kept) return holdBrief(kept.brief, ok);
  const model = await briefModel(db);
  if (!model) return null;
  let cost: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), BRIEF_TIMEOUT_MS);
    });
    const raw = await Promise.race([
      model.complete(briefMessages(input), { temperature: 0.2, maxTokens: BRIEF_REPLY_TOKENS, onUsage: (u) => (cost = typeof u.cost === "number" ? u.cost : null) }),
      timeout,
    ]);
    const brief = parseBrief(raw);
    if (!brief) {
      console.warn("[after-dark] a picture's brief came back unreadable");
      return null;
    }
    await db.query(`delete from adult_picture_briefs where owner_id = $1 and created_at < now() - interval '30 days'`, [input.owner]).catch(() => {});
    await db.query(`insert into adult_picture_briefs (key, owner_id, brief, cost) values ($1, $2, $3::jsonb, $4) on conflict (key) do nothing`, [key, input.owner, JSON.stringify(brief), cost]);
    const won = (await db.query<{ brief: Brief }>(`select brief from adult_picture_briefs where key = $1`, [key])).rows[0]?.brief ?? brief;
    return holdBrief(won, ok);
  } catch (err) {
    console.warn(`[after-dark] a picture's brief couldn't be read: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
