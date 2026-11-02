/**
 * Living dates (David, 2026-11-01: "the dates feel rudimentary"): what goes on inside each character while the date
 * plays, so they react to it instead of performing an ending (docs/date-quality.md "Round: living dates").
 *
 * Each line the actor writes now carries, privately:
 *  - a feeling toward the other (one of FEELINGS, with a strength), which is handed back on its next line as
 *    "how_you_feel_about_them": where it stands and how it moved, so a hurt or a spark carries instead of the old
 *    one-word emotion resetting every line;
 *  - a thought: one short sentence the other never hears, stored and shown only after the date airs (the episode page,
 *    folded, tap to show; the diary cam);
 *  - what the other just claimed about themselves ("they_claimed"), which builds that side's "what_theyve_told_you",
 *    so it can notice a story that doesn't add up and call it out. Its temperament's guard says how slow it is to trust.
 *
 * Privacy (lib/conversation.ts): a side's feeling, thoughts and notes reach only that side's own prompt. The other side's
 * prompt reads the conversation (what was said and done), never another's inner life. None of it is on a stored line:
 * lib/pipeline.ts takes it off every line before anything is saved or played, and keeps it in episodes.inner_life, read
 * only once the date has aired (lib/game.ts). Pure, no server imports.
 */
import { checkShowText } from "./safety";
import type { SoulSignals } from "./engine";

/** The feelings a line can carry toward the other, warm first. One word each, so a feeling can carry and be read. */
export const FEELINGS = ["smitten", "charmed", "curious", "amused", "comfortable", "unsure", "competitive", "wary", "bored", "irritated", "hurt"] as const;
export type FeelingName = (typeof FEELINGS)[number];

/** How a feeling leans: warm toward them, neither, or cooling. */
export const FEELING_LEAN: Record<FeelingName, 1 | 0 | -1> = {
  smitten: 1, charmed: 1, curious: 1, amused: 1, comfortable: 1,
  unsure: 0, competitive: 0,
  wary: -1, bored: -1, irritated: -1, hurt: -1,
};

/** Words a model reaches for, folded onto the list (anything else is "unsure"). */
const FEELING_WORDS: Record<string, FeelingName> = {
  attracted: "charmed", drawn: "charmed", delighted: "charmed", warm: "charmed", fond: "charmed", taken: "charmed", flirty: "charmed",
  besotted: "smitten", infatuated: "smitten", giddy: "smitten", swept: "smitten", enchanted: "smitten",
  intrigued: "curious", interested: "curious", fascinated: "curious", engaged: "curious",
  playful: "amused", entertained: "amused", tickled: "amused",
  relaxed: "comfortable", easy: "comfortable", calm: "comfortable", content: "comfortable", safe: "comfortable", friendly: "comfortable",
  nervous: "unsure", uncertain: "unsure", confused: "unsure", torn: "unsure", awkward: "unsure", hesitant: "unsure", neutral: "unsure",
  challenged: "competitive", rivalrous: "competitive", provoked: "competitive", spirited: "competitive", sparring: "competitive",
  suspicious: "wary", guarded: "wary", skeptical: "wary", sceptical: "wary", doubtful: "wary", defensive: "wary", cautious: "wary",
  disinterested: "bored", uninterested: "bored", flat: "bored", restless: "bored", tired: "bored",
  annoyed: "irritated", frustrated: "irritated", exasperated: "irritated", impatient: "irritated", angry: "irritated", offended: "irritated",
  sad: "hurt", stung: "hurt", disappointed: "hurt", rejected: "hurt", embarrassed: "hurt", wounded: "hurt", deflated: "hurt",
};

/** A model's word for a feeling, as one of FEELINGS (null when there was none). */
export function feelingName(raw: unknown): FeelingName | null {
  if (typeof raw !== "string") return null;
  const w = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return null;
  if ((FEELINGS as readonly string[]).includes(w)) return w as FeelingName;
  return FEELING_WORDS[w] ?? "unsure";
}

/** What one line carries privately. All optional: a reply without them is still a line. */
export type LineInner = { feeling?: FeelingName; strength?: number; thought?: string; claim?: string };

export const THOUGHT_MAX = 140;
export const CLAIM_MAX = 100;
/** How many of the other's claims one side keeps in mind (the latest). */
export const CLAIMS_KEPT = 6;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5);
const short = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…`);

/**
 * A line's private fields as the actor sent them, cleaned: a feeling on the list, a strength 0..1, and a thought and a
 * claim that pass the show's content filter (a thought is shown after airing; one that doesn't pass is dropped, never
 * the line). Empty when the reply had none.
 */
export function readInner(raw: { feeling?: unknown; feeling_strength?: unknown; thought?: unknown; they_claimed?: unknown }): LineInner {
  const out: LineInner = {};
  const f = feelingName(raw.feeling);
  if (f) {
    out.feeling = f;
    const s = typeof raw.feeling_strength === "number" ? raw.feeling_strength : Number(raw.feeling_strength);
    out.strength = Math.round(clamp01(Number.isFinite(s) ? s : 0.5) * 100) / 100;
  }
  const text = (v: unknown, max: number) => (typeof v === "string" && /\p{L}/u.test(v) ? short(v.trim(), max) : null);
  const thought = text(raw.thought, THOUGHT_MAX);
  if (thought && checkShowText({ thought }).ok) out.thought = thought;
  const claim = text(raw.they_claimed, CLAIM_MAX);
  if (claim && !/^(none|nothing|n\/a|-)\.?$/i.test(claim) && checkShowText({ claim }).ok) out.claim = claim;
  return out;
}

const strengthWord = (s: number | undefined) => (s === undefined ? "" : s >= 0.67 ? " (strongly)" : s <= 0.33 ? " (a little)" : "");

/**
 * How this side has felt about the other so far tonight, from its own earlier lines: where it is now, and how it moved
 * (the last few changes). Null before its first feeling. Only ever this side's own lines.
 */
export function feelingSoFar(lines: readonly { side: "a" | "b"; inner?: LineInner }[], side: "a" | "b"): { right_now: string; how_it_moved?: string } | null {
  const mine = lines.filter((l) => l.side === side && l.inner?.feeling).map((l) => l.inner!);
  if (!mine.length) return null;
  const last = mine[mine.length - 1];
  const path: string[] = [];
  for (const m of mine) if (path[path.length - 1] !== m.feeling) path.push(m.feeling!);
  return {
    right_now: `${last.feeling}${strengthWord(last.strength)}`,
    ...(path.length > 1 ? { how_it_moved: path.slice(-4).join(" → ") } : {}),
  };
}

/** What this side noted the other claiming tonight (its own notes, the latest CLAIMS_KEPT). */
export function claimsSoFar(lines: readonly { side: "a" | "b"; inner?: LineInner }[], side: "a" | "b"): string[] {
  return lines.filter((l) => l.side === side && l.inner?.claim).map((l) => l.inner!.claim!).slice(-CLAIMS_KEPT);
}

/**
 * How quickly this character takes the other at their word, from its temperament's guard (the same signals the engine
 * reads, lib/temperament.ts): a guarded character notices a story that doesn't add up and says so; an open book needs a
 * real contradiction, and is kind about it.
 */
export function trustStance(signals: Pick<SoulSignals, "guardedness" | "warmth">): string {
  const g = signals.guardedness;
  if (g >= 0.55) return "You're slow to trust. You notice when a story doesn't add up, and you say so, coolly or with a raised eyebrow. Trust is earned tonight, not given.";
  if (g <= 0.2) return "You take people at their word. It takes a real contradiction for you to call one out, and when you do, you're kind about it.";
  return signals.warmth >= 0.6
    ? "You give people the benefit of the doubt, but you notice when something doesn't add up, and you'll tease them about it."
    : "You give people the benefit of the doubt, up to a point: when something they say doesn't fit what they said before, you ask.";
}

/* -------------------------------------------- what's kept on the episode -------------------------------------------- */

/** One side's private answer to "see them again?" once the date is over (lib/choices.ts). */
export type SeeAgain = "yes" | "maybe" | "no";
export type Choice = { see_again: SeeAgain; reason: string; /** The model didn't answer: read from how the date went for that side. */ read?: true };

/**
 * episodes.inner_life: each line's private feeling, thought and note (aligned with the transcript), and each side's
 * own choice at the end. Never on a stored line, never shown before the date airs (lib/game.ts innerForViewer).
 */
export type StoredInner = {
  v: 1;
  lines: (LineInner | null)[];
  choices?: { a: Choice | null; b: Choice | null };
};

/** A conversation's inner life, line by line, or null when no line carried any. */
export function innerOf(lines: readonly { inner?: LineInner }[]): StoredInner | null {
  const kept = lines.map((l) => (l.inner && Object.keys(l.inner).length ? l.inner : null));
  return kept.some(Boolean) ? { v: 1, lines: kept } : null;
}

/** A line as it's stored and played: everything but its inner life. */
export function outerLine<T extends { inner?: LineInner }>(line: T): Omit<T, "inner"> {
  if (!("inner" in line)) return line;
  const { inner: _private, ...rest } = line;
  return rest;
}

/**
 * The inner life a viewer may see on an aired date: thoughts (and the side's own see-again with its reason) for the
 * sides `shown` allows (house characters, and owners who share their characters' confessionals: the same rule as the diary
 * cam), and nothing at all before the date airs, for anyone, the creators included (a thought can say how it ends).
 */
export function innerForViewer(
  inner: StoredInner | null | undefined,
  revealed: boolean,
  shown: readonly [boolean, boolean],
  transcript: readonly { side: "a" | "b" }[],
): { thoughts: (string | null)[]; choices: { side: "a" | "b"; see_again: SeeAgain; reason: string | null }[] } | null {
  if (!revealed || !inner || !Array.isArray(inner.lines)) return null;
  const ok = (side: "a" | "b") => shown[side === "a" ? 0 : 1];
  const thoughts = transcript.map((t, i) => (ok(t.side) ? (inner.lines[i]?.thought ?? null) : null));
  const choices = (["a", "b"] as const).flatMap((s) => {
    const c = inner.choices?.[s];
    return c ? [{ side: s, see_again: c.see_again, reason: ok(s) && !c.read ? c.reason : null }] : [];
  });
  if (!thoughts.some(Boolean) && !choices.length) return null;
  return { thoughts, choices };
}
