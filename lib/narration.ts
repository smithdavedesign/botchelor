/**
 * Writing styles (David, 2026-11-17: "I like chub.ai writing style … introduce different writing styles for both the
 * dates and nsfw dates"). Two styles:
 *  - **script** (every date and scene so far): a spoken line and a short action ("leans on the counter").
 *  - **narrated**: the same lines, each wrapped in a few sentences of third-person, past-tense prose about the speaker
 *    (their body, their hands, the things around them, a flicker of what they think in their own voice), the way a
 *    novel would tell it. The spoken words never change: the prose sits before and after them.
 *
 * Narration is a pass over lines already written and checked, never a change to how they're written: every date's and
 * scene's own prompts, craft checks, limits and safety checks run as before, then one call narrates the new lines. A
 * beat that fails the same checks the lines pass (checkShowText for the show, checkAdultText and the viewer's hard nos
 * for After Dark) is dropped, and that line shows as a script line. The theater, the pictures and the voices keep
 * reading the lines themselves.
 *
 * And a **story**: a finished date or chapter told again as prose, from start to end (lib/stories.ts keeps them).
 *
 * And **story mode** (at the end of this file): a scene reply written as prose in ONE call, for a scene a person is in
 * themselves (a companion's scene, lib/companion.ts). No pass: the reply is prose from the start, checked as a whole
 * by the caller's line checks and then by the guard here. Its craft, parsing and guard are exported for every side.
 *
 * Who gets the narrated style, and what it costs, is lib/writing-style.ts.
 */
import type { ChatMessage, Model, ModelOptions } from "./model";
import { checkAdultText, checkShowText } from "./safety";
import { storySpeech } from "./story-reply";
import { escapeRegExp } from "./text";

export * from "./story-reply";

export const WRITING_STYLES = ["script", "narrated"] as const;
export type WritingStyle = (typeof WRITING_STYLES)[number];
export const isWritingStyle = (x: unknown): x is WritingStyle => typeof x === "string" && (WRITING_STYLES as readonly string[]).includes(x);
/** A stored or sent style, "script" for anything else. */
export const styleOf = (x: unknown): WritingStyle => (isWritingStyle(x) ? x : "script");

/** Which checks narration answers to: the show's (PG) or After Dark's. */
export type Rating = "pg" | "adult";

/** The prose around one spoken line: what comes before the words and what comes after. Either can be empty. */
export type Beat = { before: string; after: string };

/** One line to narrate: who says it (a first name), what they say, and what they do (the script's action), if anything. */
export type NarrateLine = { who: string; dialogue: string; action?: string };

/** The longest part of a beat (characters): a few sentences. A longer one is cut back to its last whole sentence. */
export const BEAT_PART_MAX = 420;
/**
 * The most lines one call narrates: a longer run goes in several calls. Eight keeps a call's reply near a thousand
 * tokens, well inside the show's 25 s model timeout (lib/model.ts MODEL_TIMEOUT_MS).
 */
export const NARRATE_BATCH = 8;
/** The lines before the new ones the narrator reads, for flow (never narrated again). */
export const NARRATE_CONTEXT = 6;

/**
 * Worn phrases long AI prose leans on (the style's main risk on the open models we run: DeepSeek, GLM, Gemini Flash).
 * Named in the prompt; a beat that uses one anyway loses that sentence (wornCut).
 */
export const WORN_PHRASES = [
  "breath she didn't know she was holding",
  "breath he didn't know he was holding",
  "breath they didn't know they were holding",
  "something shifted",
  "a shiver ran down",
  "shivers down",
  "electricity",
  "the air between them",
  "the air thick with",
  "air was thick",
  "eyes darkened",
  "smirked",
  "smirk",
  "padded over",
  "ministrations",
  "couldn't help but",
  "sent a jolt",
  "barely above a whisper",
  "a beat passed",
  "time seemed to",
  "the world fell away",
  "heart hammered",
  "testament to",
] as const;

/**
 * The craft rules every kind of narrated prose shares (a line's beat, a story, a scene reply written as prose in story
 * mode below): feeling shown through the body, plain words, and the worn phrases by name. Exported so each prompt says
 * them in the same words.
 */
export const CRAFT_SHOW_FEELING =
  "Show how they feel through what their body and hands do (knuckles pale on the counter, setting a glass down very deliberately), never by naming the feeling (\"she felt nervous\").";
export const CRAFT_PLAIN_WORDS = "Plain, specific, concrete words. Nothing purple, no metaphors stacked on metaphors, nothing that reads like a romance novel's back cover.";
export const WORN_RULE = `Never use these worn phrases: ${WORN_PHRASES.slice(0, 18).map((p) => `"${p}"`).join(", ")}.`;

/** The craft the narrator writes to: what made the example David liked work, said as rules. */
const CRAFT = [
  "Third person, past tense, close on whoever speaks the line: what they do with their hands and body, the things around them (a cup, a chair, the counter, the rain on the window), what they notice about the other one, and now and then a flicker of what they think, in their own voice and words (\"Cool. Fantastic.\").",
  CRAFT_SHOW_FEELING,
  "Vary the rhythm: some beats are one short sentence, some are two or three; some lines get prose only before the words, some only after, a few get none at all. Now and then a beat is a single short line on its own, like \"It buzzed again.\"",
  "Answer what was just said: when a line repeats or reacts to the other one's words, the prose can show it landing (a pause, a look, a laugh that comes out wrong).",
  "Fold the line's action into the prose; don't repeat it word for word.",
  CRAFT_PLAIN_WORDS,
];

/** What a narrator may never do, whatever the lines are: it tells, it never adds. */
const NEVER = [
  "Never change, repeat, quote or paraphrase the spoken words: they're printed between your two parts exactly as written. No quotation marks in your prose.",
  "Never add an event: nobody arrives, leaves, moves somewhere else, touches, kisses or undresses unless the lines themselves say so. You tell what the lines show, more closely; you don't move the story on.",
  "Never put words in the other one's mouth, and never say what the other one thinks or feels: only what the speaker can see of them.",
  WORN_RULE,
];

const RATING_RULE: Record<Rating, string> = {
  pg: "This is a PG dating show: warmth, nerves, flirting and at most a kiss. Nothing sexual, no innuendo, nothing about bodies beyond hands, faces, posture and clothes. Everyone is an adult.",
  adult:
    "This is an adults-only scene between two fictional adults. The prose can be as explicit as the lines are, never more: it describes what the lines show, with the same frankness, and goes no further. Both are adults: nothing about school, family or anyone young, ever.",
};

/** The prompt for narrating `lines` (after `before`, read for flow only). */
export function narrationPrompt(input: {
  rating: Rating;
  /** The two (or more) people, by first name, with a few words each on who they are, when known. */
  people: readonly { name: string; about?: string }[];
  place: string | null;
  lines: readonly NarrateLine[];
  before?: readonly NarrateLine[];
}): ChatMessage[] {
  const said = (l: NarrateLine) => `${l.who}: ${l.dialogue.trim() || "(says nothing)"}${l.action?.trim() ? ` [does: ${l.action.trim()}]` : ""}`;
  const system = [
    "You are the narrator of a story told in dialogue. Each line below is something a character says (and sometimes does). You write the prose around each line: a few words to three sentences, before the spoken words, after them, or both, so the whole reads like a novel.",
    "",
    "How to write it:",
    ...CRAFT.map((c) => `- ${c}`),
    "",
    "Never:",
    ...NEVER.map((c) => `- ${c}`),
    "",
    RATING_RULE[input.rating],
    "Write in English.",
  ].join("\n");
  const user = [
    `Who's here: ${input.people.map((p) => (p.about ? `${p.name} (${p.about})` : p.name)).join("; ")}.`,
    input.place ? `Where: ${input.place}.` : "",
    input.before?.length ? `Just before (already told, for flow only):\n${input.before.map(said).join("\n")}` : "",
    `The lines to narrate, numbered:\n${input.lines.map((l, i) => `${i + 1}. ${said(l)}`).join("\n")}`,
    "",
    `Reply with a JSON object: {"beats": [{"n": 1, "before": "prose before line 1's words, or \\"\\"", "after": "prose after them, or \\"\\""}, …]}, one entry per numbered line, in order.`,
  ]
    .filter(Boolean)
    .join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** A model's JSON answer, from inside a code fence or prose around it. */
function jsonOf(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * What can be saved of a beats reply the length cap cut off mid-JSON (a thinking model can spend its budget before the
 * closing brace: the first live story did, 2026-11-17): every whole `{…}` entry. The lines after the cut stay script
 * lines. Null when there's nothing whole.
 */
function salvage(raw: string): { beats: unknown[] } | null {
  const beats = (raw.match(/\{[^{}]*\}/g) ?? [])
    .map((o) => {
      try {
        return JSON.parse(o) as unknown;
      } catch {
        return null;
      }
    })
    .filter((o) => o !== null);
  return beats.length ? { beats } : null;
}

const SENTENCE_END = /[.!?…](?:["'’”)\]]*)(?=\s|$)/g;

/** A part of a beat tidied: one line of prose, quotes and asterisks out, cut back to its last whole sentence under `max`. */
export function tidyPart(raw: unknown, max = BEAT_PART_MAX): string {
  if (typeof raw !== "string") return "";
  let t = raw
    .replace(/\*+/g, "")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > max) {
    const head = t.slice(0, max);
    let cut = -1;
    for (const m of head.matchAll(SENTENCE_END)) cut = (m.index ?? 0) + m[0].length;
    t = cut > 0 ? head.slice(0, cut).trim() : "";
  }
  // A part that never ends a sentence was cut mid-thought by the model's length cap: it goes back to the last whole one.
  if (t && !/[.!?…]["'’”)\]]*$/.test(t)) {
    let cut = -1;
    for (const m of t.matchAll(SENTENCE_END)) cut = (m.index ?? 0) + m[0].length;
    t = cut > 0 ? t.slice(0, cut).trim() : `${t}.`;
  }
  return t;
}

/** Whether a sentence uses one of the worn phrases (WORN_PHRASES). */
export function hasWornPhrase(sentence: string): boolean {
  const low = sentence.toLowerCase().replace(/[’]/g, "'");
  return WORN_PHRASES.some((p) => new RegExp(`\\b${escapeRegExp(p)}\\b`).test(low));
}

/** A part without the sentences that use a worn phrase (WORN_PHRASES); how many went. */
export function wornCut(text: string): { text: string; cut: number } {
  if (!text) return { text, cut: 0 };
  const sentences = text.match(/[^.!?…]+[.!?…]+["'’”)\]]*|[^.!?…]+$/g) ?? [text];
  let cut = 0;
  const kept = sentences.filter((s) => {
    const worn = hasWornPhrase(s);
    if (worn) cut++;
    return !worn;
  });
  return { text: kept.join(" ").replace(/\s+/g, " ").trim(), cut };
}

/** The beats in a narrator's reply, one per line (null where none came or it was empty). */
export function parseBeats(raw: string, count: number): (Beat | null)[] {
  const out: (Beat | null)[] = Array.from({ length: count }, () => null);
  const j = (jsonOf(raw) ?? salvage(raw)) as { beats?: unknown } | unknown[] | null;
  const list = Array.isArray(j) ? j : Array.isArray((j as { beats?: unknown } | null)?.beats) ? ((j as { beats: unknown[] }).beats as unknown[]) : [];
  list.forEach((x, i) => {
    if (!x || typeof x !== "object") return;
    const o = x as { n?: unknown; before?: unknown; after?: unknown };
    const n = typeof o.n === "number" && Number.isInteger(o.n) && o.n >= 1 && o.n <= count ? o.n - 1 : i;
    if (n < 0 || n >= count || out[n]) return;
    const before = tidyPart(o.before);
    const after = tidyPart(o.after);
    if (before || after) out[n] = { before, after };
  });
  return out;
}

/**
 * The narrator's own guard, on top of the checks the lines pass (the tests found both miss things prose says): "She was
 * only fifteen" passed the show's check, "a kid of maybe sixteen" passed After Dark's, and "She took off her bra" the
 * show's. Prose is new text describing people and bodies, so it answers to more than dialogue does:
 *  - every rating: an age under 18 said in passing ("only fifteen", "about twelve", "aged 16"), never a time or a count;
 *    and the minor terms After Dark already refuses (checkAdultText), on the show too;
 *  - the show: underwear and undressing words (a PG date never undresses, so its prose never does either);
 *  - After Dark: anything young (a kid, a child, school) and any family word, in any sense: the night's prose never
 *    brings anyone's family in.
 * A beat that trips it goes, and its line stays a script line; a story that trips it isn't kept.
 * A score isn't an age: "seven out of ten" and "on a scale of 1 to 10" pass (a character whose habit is rating things
 * out of ten had a Step in reply refused for it, 2026-11-19).
 */
const AGE_UNDER_18 = new RegExp(
  String.raw`(?<!\bout\s+)\b(?:only|just|barely|maybe|about|around|aged?|of)\s+(?:ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|[1-9]|1[0-7])\b(?!\s*(?:minutes?|mins?|seconds?|hours?|o'?clock|a\.?m\b|p\.?m\b|percent|%|dollars?|bucks|blocks?|feet|foot|inches|miles?|steps?|times?|days?|weeks?|months?|degrees?|euros?|pounds?|rounds?|songs?|tables?|people|of (?:us|them)|to (?:ten|10)\b))`,
  "i",
);
const YOUNG = /\b(?:kid|kids|kiddo|child|children|childish|childlike|little girl|little boy|young girl|young boy|teen\w*|minor|minors|underage|school\w*|student|students|classroom|homework|curfew|puberty|baby[- ]?faced)\b/i;
const FAMILY = /\b(?:mom|moms|mommy|mum|mummy|mother|mothers|dad|dads|daddy|father|fathers|brother|brothers|sister|sisters|sibling|siblings|daughter|daughters|son|sons|aunt|aunts|uncle|uncles|niece|nephew|cousin|cousins|grandma|grandpa|grandmother|grandfather|stepmom|stepdad|step\w+|parents?|family)\b/i;
const PG_BODY = /\b(?:bra|bras|bralette|panties|panty|underwear|lingerie|thong|thongs|knickers|boxers|topless|shirtless|nipples?|cleavage|crotch|groin|bulge|buttocks|undress\w*|unbutton\w*|unzip\w*|unhook\w*|strip(?:s|ped|ping)?|naked|nude|thighs?|breasts?|chest heaving)\b/i;

/** The guard's age rule alone (every rating): what a story's quoted lines answer to, on top of their own line checks. */
export function ageGuard(text: string, rating: Rating): string | null {
  const plain = text.replace(/[’]/g, "'");
  if (AGE_UNDER_18.test(plain)) return "age";
  if (!checkAdultText({ narration: plain }).ok && rating === "pg") return "minor";
  return null;
}

export function narrationGuard(text: string, rating: Rating): string | null {
  const plain = text.replace(/[’]/g, "'");
  const age = ageGuard(plain, rating);
  if (age) return age;
  if (rating === "pg" && PG_BODY.test(plain)) return "body";
  if (rating === "adult" && YOUNG.test(plain)) return "young";
  if (rating === "adult" && FAMILY.test(plain)) return "family";
  return null;
}

/** Whether a beat passes the checks its lines pass (the show's for PG, After Dark's and the hard nos for adult) and the narrator's own guard. */
export function beatPasses(beat: Beat, rating: Rating, extra?: (text: string) => string | null): boolean {
  const fields = { narration: [beat.before, beat.after].filter(Boolean) };
  const ok = rating === "pg" ? checkShowText(fields).ok : checkAdultText(fields).ok;
  if (!ok) return false;
  for (const part of fields.narration) if (narrationGuard(part, rating) || extra?.(part)) return false;
  return true;
}

/** What a narration pass did: the beats (null where a line stays a script line) and what it threw away. */
export type Narration = { beats: (Beat | null)[]; held: number; worn: number; failed: boolean };

/**
 * Narrates `lines` in batches of NARRATE_BATCH, each read after the lines before it. Never throws: a call that fails
 * leaves its lines as script lines (`failed`). `extra` is one more check a beat has to pass (After Dark's hard nos).
 */
export async function narrate(
  model: Model,
  input: {
    rating: Rating;
    people: readonly { name: string; about?: string }[];
    place: string | null;
    lines: readonly NarrateLine[];
    before?: readonly NarrateLine[];
    extra?: (text: string) => string | null;
  },
  opts: Pick<ModelOptions, "onUsage" | "onServed"> = {},
): Promise<Narration> {
  const beats: (Beat | null)[] = [];
  let held = 0;
  let worn = 0;
  let failed = false;
  for (let from = 0; from < input.lines.length; from += NARRATE_BATCH) {
    const batch = input.lines.slice(from, from + NARRATE_BATCH);
    const before = [...(input.before ?? []), ...input.lines.slice(0, from)].slice(-NARRATE_CONTEXT);
    let parsed: (Beat | null)[] = batch.map(() => null);
    try {
      const raw = await model.complete(narrationPrompt({ rating: input.rating, people: input.people, place: input.place, lines: batch, before }), {
        temperature: 0.8,
        frequencyPenalty: 0.3,
        // Room for a thinking model's thinking too (it bills, and counts, as output: the show's narrator spent 649 of
        // 1,452 output tokens thinking on its first live date, 2026-11-17).
        maxTokens: 220 * batch.length + 1200,
        ...opts,
      });
      parsed = parseBeats(raw, batch.length);
    } catch {
      failed = true;
    }
    for (const b of parsed) {
      if (!b) {
        beats.push(null);
        continue;
      }
      const before = wornCut(b.before);
      const after = wornCut(b.after);
      worn += before.cut + after.cut;
      const beat = { before: before.text, after: after.text };
      if (!beat.before && !beat.after) {
        beats.push(null);
        continue;
      }
      if (!beatPasses(beat, input.rating, input.extra)) {
        held++;
        beats.push(null);
        continue;
      }
      beats.push(beat);
    }
  }
  return { beats, held, worn, failed };
}

// ---------------------------------------------------------------------------------------------------------------------
// Stories: a whole date or chapter told again as prose.

/** A story: a title and its paragraphs, each a run of prose with the spoken words in quotes. */
export type Story = { title: string; paragraphs: string[] };
/** The most lines a story is told from (the latest, when there are more). */
export const STORY_LINES_MAX = 80;
export const STORY_PARAGRAPH_MAX = 1400;
export const STORY_PARAGRAPHS_MAX = 40;

/** The prompt for telling `lines` again as a story. */
export function storyPrompt(input: {
  rating: Rating;
  people: readonly { name: string; about?: string }[];
  place: string | null;
  /** A sentence or two of what came before (a recap), when there's one. */
  context?: string | null;
  lines: readonly NarrateLine[];
}): ChatMessage[] {
  const said = (l: NarrateLine) => `${l.who}: ${l.dialogue.trim() || "(says nothing)"}${l.action?.trim() ? ` [does: ${l.action.trim()}]` : ""}`;
  const system = [
    "You turn a transcript of two people's evening into a short story: the same evening, told as prose by a narrator, the way a good novel would tell it.",
    "",
    "How to write it:",
    "- Third person, past tense. Keep the spoken lines that matter in quotation marks, word for word or trimmed (never reworded into something they didn't say); leave out small talk that goes nowhere.",
    ...CRAFT.slice(1).map((c) => `- ${c}`),
    "- Paragraphs of one to five sentences; dialogue inside the prose, the way a novel does it. Now and then a paragraph is a single short line.",
    "- Close on one of them at a time, a paragraph at a time; what the other one thinks only shows through what they say and do.",
    "",
    "Never:",
    "- Never add an event the transcript doesn't have, and never change how it ends.",
    `- ${WORN_RULE}`,
    "",
    RATING_RULE[input.rating],
    "Write in English.",
  ].join("\n");
  const user = [
    `Who's here: ${input.people.map((p) => (p.about ? `${p.name} (${p.about})` : p.name)).join("; ")}.`,
    input.place ? `Where: ${input.place}.` : "",
    input.context ? `Before this: ${input.context}` : "",
    `The transcript:\n${input.lines.map(said).join("\n")}`,
    "",
    'Reply with a JSON object: {"title": "a short title, 2 to 6 words", "paragraphs": ["…", "…"]}.',
  ]
    .filter(Boolean)
    .join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** The story in a reply, or null when there's none worth showing (no paragraphs, or too little of one). */
export function parseStory(raw: string): Story | null {
  // A reply the length cap cut off is no story: one kept without its ending would be kept for good (salvage is for beats).
  const j = jsonOf(raw) as { title?: unknown; paragraphs?: unknown } | null;
  if (!j || !Array.isArray(j.paragraphs)) return null;
  const paragraphs = j.paragraphs
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.replace(/\*+/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((p) => (p.length > STORY_PARAGRAPH_MAX ? p.slice(0, STORY_PARAGRAPH_MAX).replace(/\s+\S*$/, "") + "…" : p))
    .slice(0, STORY_PARAGRAPHS_MAX);
  if (paragraphs.length < 2) return null;
  const title = typeof j.title === "string" ? j.title.replace(/["“”*]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) : "";
  return { title: title || "Their evening", paragraphs };
}

/** What telling a story did: the story, or why there's none ("held": it failed the checks; "empty": nothing usable came). */
export type StoryResult = { ok: true; story: Story; worn: number; guarded: number } | { ok: false; why: "held" | "empty" | "failed" };

/**
 * Tells `lines` (the latest STORY_LINES_MAX) as a story. A sentence with a worn phrase, or one the narrator's guard
 * refuses (guardStory), goes. Any paragraph that fails the checks the lines themselves pass, or the viewer's hard nos,
 * fails the whole story, as does a story the guard cut too much of.
 */
export async function tellStory(
  model: Model,
  input: {
    rating: Rating;
    people: readonly { name: string; about?: string }[];
    place: string | null;
    context?: string | null;
    lines: readonly NarrateLine[];
    extra?: (text: string) => string | null;
  },
  opts: Pick<ModelOptions, "onUsage" | "onServed"> = {},
): Promise<StoryResult> {
  const lines = input.lines.slice(-STORY_LINES_MAX);
  if (!lines.length) return { ok: false, why: "empty" };
  let raw: string;
  try {
    raw = await model.complete(storyPrompt({ ...input, lines }), { temperature: 0.8, frequencyPenalty: 0.3, maxTokens: Math.min(8000, 150 * lines.length + 2500), ...opts });
  } catch {
    return { ok: false, why: "failed" };
  }
  const story = parseStory(raw);
  if (!story) return { ok: false, why: "empty" };
  let worn = 0;
  let guarded = 0;
  const paragraphs = story.paragraphs
    .map((p) => {
      const w = wornCut(p);
      worn += w.cut;
      const g = guardStory(w.text, input.rating);
      guarded += g.cut;
      return g.text;
    })
    .filter(Boolean);
  const title = narrationGuard(story.title, input.rating) ? "Their evening" : story.title;
  const all = { narration: [title, ...paragraphs] };
  const ok = input.rating === "pg" ? checkShowText(all).ok : checkAdultText(all).ok;
  if (!ok || all.narration.some((p) => input.extra?.(p))) return { ok: false, why: "held" };
  // The guard cut too much of it to still be the evening: no story, rather than one full of holes.
  if (guarded > Math.max(2, Math.ceil(paragraphs.length / 2))) return { ok: false, why: "held" };
  if (paragraphs.length < 2) return { ok: false, why: "empty" };
  return { ok: true, story: { title, paragraphs }, worn, guarded };
}

const QUOTED = /“[^”]*”|"[^"]*"/g;
const SENTENCES = /[^.!?…]+(?:[.!?…]+["'’”)\]]*\s*|$)/g;

/**
 * The narrator's guard over a story's paragraph (the first live After Dark story, 2026-11-17, was held whole: a story
 * quotes the lines, and the guard's prose rules were read against them too). A story's quoted lines are the date's own,
 * already held to the line checks, so they answer only to those and to the age rule; the prose between them answers to
 * the whole guard. A sentence that trips it goes, and the rest stays; how many went. `also`: one more reason a prose
 * sentence goes (never a quoted line), for a caller with rules of its own (story mode's, below).
 */
export function guardStory(text: string, rating: Rating, also?: (sentence: string) => boolean): { text: string; cut: number } {
  let cut = 0;
  const keep = (s: string, quoted: boolean): boolean => {
    if (!s.trim()) return true;
    const hit = quoted ? Boolean(ageGuard(s, rating)) : Boolean(narrationGuard(s, rating)) || also?.(s) === true;
    if (hit) cut++;
    return !hit;
  };
  const prose = (s: string) => (s.match(SENTENCES) ?? []).filter((x) => keep(x, false)).join("");
  let out = "";
  let last = 0;
  for (const m of text.matchAll(QUOTED)) {
    out += prose(text.slice(last, m.index));
    if (keep(m[0], true)) out += m[0];
    last = (m.index ?? 0) + m[0].length;
  }
  out += prose(text.slice(last));
  return { text: out.replace(/\s+/g, " ").trim(), cut };
}

// ---------------------------------------------------------------------------------------------------------------------
// Story mode: a scene reply written as prose in ONE call (the roleplay audit, 2026-11-17, item 1: "replies written as
// prose in one go (not the script plus a narration pass) … the character moves the scene on instead of asking what you
// want"). For a scene a person is in themselves: a companion's scene (lib/companion.ts), and After Dark's own, with its
// own prompt and checks around this (lib/adult/step-in.ts, which this file never imports).
//
// What's here is neutral. The craft and the parsing know no rating and the guard takes one, so each side's prompt keeps
// its own rules around it (PG or not, honesty about being AI, the crisis rules) and runs its own line checks on the
// reply as a whole before the guard. lib/story-reply.ts reads a stored reply back (paragraphs, speech, runs).

/** How much a story reply is, by the thread's reply length: its paragraphs, fewest and most. */
export type StoryLength = "short" | "normal" | "long";
export const STORY_MODE_PARAGRAPHS: Record<StoryLength, readonly [number, number]> = { short: [1, 2], normal: [2, 3], long: [3, 4] };
/** The longest paragraph of a story reply (characters): a longer one is cut back to its last whole sentence. */
export const STORY_MODE_PARAGRAPH_MAX = 700;
/** The most paragraphs a story reply keeps, whatever came back. */
export const STORY_MODE_PARAGRAPHS_MAX = 5;

/**
 * The character drives. Every scene prompt carries this one, script or story: the field's products hand the scene back
 * ("what would you like to do?") and the person ends up writing both sides.
 */
export const SCENE_DRIVE_RULE =
  'You drive the scene: every reply moves it on. Something happens, you do the next thing, or you say where it goes next. Never hand it back with "what would you like to do?" or "what now?", and ask at most one question.';

/**
 * It never writes the person. The field's most documented complaint (docs/audits/2026-11-17-roleplay-vs-the-field.md,
 * "Where Botchelor is ahead": "the model narrating for me"), and the rule the script prompt has always had for stage
 * directions, said for prose.
 */
export const NEVER_WRITE_THE_PERSON =
  'Never write the person you\'re with. Nothing "you" did, said, thought or felt goes in beyond what they actually sent: no words in their mouth, no movement, no reaction, no decision made for them. What they do next is theirs to write.';

const COUNT = ["no", "one", "two", "three", "four", "five"];

/**
 * How a story reply is written, as the lines of a prompt's "how it's written" block: who is "you" and who is told in the
 * third person, speech in double quotes, how long, the shared craft, the two rules above and the worn phrases. `name`
 * is the character's (first name); `pronouns` theirs when known.
 */
export function storyModeRules(o: { name: string; pronouns?: string | null; length: StoryLength }): string[] {
  const [least, most] = STORY_MODE_PARAGRAPHS[o.length];
  const who = o.pronouns ? `${o.name}, ${o.pronouns}` : `${o.name}, by name`;
  return [
    `This scene is told as prose, the way a novel would tell it, and you write your side of it. Third person and past tense for yourself (${who}); the person you're with is always "you".`,
    "What you say out loud goes in double quotes inside the prose, curly ones “like this” (never single quotes), and you say at least one thing out loud.",
    `${COUNT[least][0].toUpperCase()}${COUNT[least].slice(1)} or ${COUNT[most]} short paragraphs, a few sentences each. No headings, no lists, no asterisks.`,
    CRAFT_SHOW_FEELING,
    "Use the things in the place: what's on the table, the light, the weather, what the hands find to do.",
    CRAFT_PLAIN_WORDS,
    SCENE_DRIVE_RULE,
    NEVER_WRITE_THE_PERSON,
    WORN_RULE,
  ];
}

/** The answer a story reply comes in. */
export const STORY_MODE_ANSWER = 'Answer only JSON: {"story":["first paragraph","second paragraph"]}, one string a paragraph.';

/**
 * Room for a story reply to finish: its paragraphs, and a thinking model's thinking before them (it counts, and bills,
 * as output: a small cap comes back empty).
 */
export const storyModeTokens = (length: StoryLength): number => 1200 + 350 * STORY_MODE_PARAGRAPHS[length][1];

const balanced = (s: string) => (s.match(/"/g) ?? []).length % 2 === 0 && (s.match(/“/g) ?? []).length === (s.match(/”/g) ?? []).length;

/**
 * A bracket or brace left from the answer's JSON at a paragraph's edge with no partner inside it (the first live Step
 * in scene, 2026-11-17, ended a reply on "…this particular coordinate?']").
 */
function strayBrackets(t: string): string {
  let s = t;
  if (!s.includes("[")) s = s.replace(/\]+$/, "").trim();
  if (!s.includes("]")) s = s.replace(/^\[+/, "").trim();
  if (!s.includes("{")) s = s.replace(/\}+$/, "").trim();
  if (!s.includes("}")) s = s.replace(/^\{+/, "").trim();
  return s;
}

/**
 * Speech in single quotes ('Pardon me,' she said): a model answering inside a JSON string often writes it that way to
 * save escaping (the first live Step in scene did, every line), and then the page, the voice and the checks of who
 * says what can't find it. A quote opens at the start or after a space, a bracket or a dash, and closes on the
 * sentence's own punctuation; an apostrophe inside a word (I'm, Anthea's) is never one. Each pair becomes “…”.
 */
const SINGLE_QUOTED = /(^|[\s([—–])['‘]([^\s'‘’](?:[^'‘’]|(?<=\p{L})['’](?=\p{L}))*?[.,!?…—–-])['’](?=$|[\s)\]—–.,;:!?])/gu;
/** A paragraph's single-quoted speech in double quotes; one that has double quotes of its own is left as it is. */
export function speechInDoubleQuotes(t: string): string {
  return /["“”]/.test(t) ? t : t.replace(SINGLE_QUOTED, "$1“$2”");
}

/** One paragraph of a story reply tidied: one line, no asterisks, its speech in double quotes, cut back to a whole sentence (with its quotes closed) under the limit. */
function tidyStoryParagraph(raw: string): string {
  const t = speechInDoubleQuotes(strayBrackets(raw.replace(/\*+/g, "").replace(/\s+/g, " ").trim()));
  if (t.length <= STORY_MODE_PARAGRAPH_MAX) return t;
  const head = t.slice(0, STORY_MODE_PARAGRAPH_MAX);
  let cut = -1;
  for (const m of head.matchAll(SENTENCE_END)) {
    const end = (m.index ?? 0) + m[0].length;
    if (balanced(head.slice(0, end))) cut = end;
  }
  return cut > 0 ? head.slice(0, cut).trim() : "";
}

/**
 * The paragraphs in a story reply: {"story": [...]} (or "paragraphs"; a single string splits on blank lines), the whole
 * strings of one cut off mid-answer, or plain prose's paragraphs. Each tidied; empty when nothing came.
 */
export function parseStoryReply(raw: string): string[] {
  const trimmed = raw.trim();
  let parts: string[] = [];
  const j = jsonOf(raw) as { story?: unknown; paragraphs?: unknown } | null;
  if (j && typeof j === "object") {
    const listed = j.story ?? j.paragraphs;
    parts = Array.isArray(listed) ? listed.filter((p): p is string => typeof p === "string") : typeof listed === "string" ? [listed] : [];
  } else if (trimmed.startsWith("{") || trimmed.startsWith("```")) {
    // Cut off at the token limit: keep each paragraph that closed.
    const at = trimmed.indexOf('"story"');
    if (at >= 0) {
      parts = [...trimmed.slice(at + '"story"'.length).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => {
        try {
          return JSON.parse(`"${m[1]}"`) as string;
        } catch {
          return "";
        }
      });
    }
  } else parts = [raw];
  return parts
    .flatMap((p) => p.replace(/\r/g, "").split(/\n\s*\n/))
    .map(tidyStoryParagraph)
    .filter(Boolean)
    .slice(0, STORY_MODE_PARAGRAPHS_MAX);
}

const SPEECH_VERB =
  "say|says|said|ask|asks|asked|reply|replies|replied|answer|answers|answered|whisper|whispers|whispered|murmur|murmurs|murmured|mutter|mutters|muttered|add|adds|added|admit|admits|admitted|call|calls|called|laugh|laughs|laughed|tell|tells|told|shout|shouts|shouted|joke|jokes|joked|tease|teases|teased|agree|agrees|agreed|protest|protests|protested|offer|offers|offered|respond|responds|responded|insist|insists|insisted|counter|counters|countered|suggest|suggests|suggested";
/** A quoted line given to "you": `You said, "…"` and `"…," you said`. */
const YOU_SPEAK = [
  // The quote opens after a space ("You said, “…”"): a comma right against a quote mark is one closing, the character's own.
  new RegExp(`\\b[Yy]ou\\s+(?:\\w+\\s+){0,3}?(?:${SPEECH_VERB})\\b[^.!?"“”]{0,60}[,:]\\s+["“]`),
  new RegExp(`[,!?—-]["”]\\s+you\\s+(?:${SPEECH_VERB})\\b`),
];
/**
 * "You" given a thought or a feeling in the narration. Past-tense and plainly inner verbs only: the prose is in the
 * past tense, and a present "you know" or "you want" is nearly always the general "you".
 */
const YOU_INNER =
  /\byou(?:\s+(?:just|suddenly|almost|really|already|still|never|finally|quietly|secretly))?\s+(?:feel|felt|think|thought|realise|realised|realize|realized|wonder|wondered|decide|decided|knew|wanted|wish|wished|hope|hoped|can't help|couldn't help|find yourself|found yourself)\b/i;

/** Whether a story reply puts words in the person's mouth: a quoted line said by "you". The reply is drawn again. */
export function speaksForThePerson(text: string): boolean {
  return YOU_SPEAK.some((re) => re.test(text));
}

/** Whether a sentence of narration gives the person a thought or a feeling ("you felt…", "you wondered…"). It's cut. */
export function thinksForThePerson(sentence: string): boolean {
  return YOU_INNER.test(sentence);
}

/**
 * Whether a story reply's narration has slipped into telling the person in the third person, and the word it used:
 * outside the quotes, "you" nowhere, the character told by their own pronouns, and the other set there too ("she…
 * him" for a character who is a she). That other one is the person: two people in the prose and neither is "you".
 * Story mode says "you" from first to last, but a long scene can drift (the first Step in test, 2026-11-19: "then he
 * was beside her", "her fingers brushing lightly over a freckle on his collarbone"), and once it says "he" the checks
 * above, which read "you", can't see it write the person. Only for a character whose pronouns are he or she: with
 * they, or a character the same as the person, the two can't be told apart.
 */
const THEIR_PERSON = /\b(?:his|her|their) (guest|visitor|companion|date|partner|lover|caller)\b/i;
export function tellsThemInThirdPerson(text: string, ownPronouns: string | null | undefined): string | null {
  const own = /^\s*she\b/i.test(ownPronouns ?? "") ? "she" : /^\s*he\b/i.test(ownPronouns ?? "") ? "he" : null;
  if (!own) return null;
  const prose = text.replace(/“[^”]*”|"[^"]*"/g, " ");
  if (/\b(?:you|your|yours|yourself)\b/i.test(prose)) return null;
  const [mine, theirs] = own === "she" ? [/\b(?:she|her|hers|herself)\b/i, /\b(he|him|his|himself)\b/i] : [/\b(?:he|him|his|himself)\b/i, /\b(she|her|hers|herself)\b/i];
  if (!mine.test(prose)) return null;
  // The person as a noun of the character's ("He found his guest already inside": a live redraw, 2026-11-23): with no
  // "you" anywhere in the prose, the one other person in a scene for two is them.
  return prose.match(theirs)?.[1].toLowerCase() ?? prose.match(THEIR_PERSON)?.[1].toLowerCase() ?? null;
}

/**
 * What the guard made of a story reply, or why it can't be used:
 *  - "empty": no paragraphs came (or none survived);
 *  - "silent": nothing is said out loud, so the stage and the voice would have nothing;
 *  - "speaks_for_them": it wrote a line for the person;
 *  - "cut": the guard took more than a third of it.
 */
export type StoryReply =
  | { ok: true; paragraphs: string[]; speech: string[]; cut: number }
  | { ok: false; why: "empty" | "silent" | "speaks_for_them" | "cut"; cut: number };

/**
 * A parsed story reply through the narrator's guard, a paragraph at a time (guardStory): a sentence of narration goes
 * when the guard refuses it, when it uses a worn phrase, or when it thinks or feels for the person; quoted speech
 * answers to the caller's line checks (run before this, on the reply as a whole) and the age rule. Not usable when the
 * guard took more than a third of it (by length), when nothing is said out loud, or when it speaks for the person.
 */
export function guardStoryReply(paragraphs: readonly string[], rating: Rating): StoryReply {
  if (!paragraphs.length) return { ok: false, why: "empty", cut: 0 };
  if (speaksForThePerson(paragraphs.join(" "))) return { ok: false, why: "speaks_for_them", cut: 0 };
  let cut = 0;
  let before = 0;
  let after = 0;
  const kept: string[] = [];
  for (const p of paragraphs) {
    const g = guardStory(p, rating, (s) => hasWornPhrase(s) || thinksForThePerson(s));
    cut += g.cut;
    before += p.length;
    after += g.text.length;
    if (g.text) kept.push(g.text);
  }
  if (!kept.length) return { ok: false, why: "empty", cut };
  if (after < (before * 2) / 3) return { ok: false, why: "cut", cut };
  const speech = storySpeech(kept.join("\n\n"));
  if (!speech.length) return { ok: false, why: "silent", cut };
  return { ok: true, paragraphs: kept, speech, cut };
}
