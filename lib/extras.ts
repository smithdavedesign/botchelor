/**
 * A character's optional details — the dating-profile layer on top of the sheet: what they do, where they're
 * from, their style, hobbies, quirks, what a good date looks like to them, a few Hinge-style profile prompts,
 * the voice kit (sample lines in their voice, things they'd never say, and their tells), and up to 20 facts of
 * the creator's own ("Allergic to: coriander"). All optional and content-filtered like the sheet. Everything is
 * public (shown on the contestant card) except a fact marked private: that one only ever reaches its own
 * character's prompts and its owner (publicExtras strips it everywhere else).
 *
 * They reach the date's models as the character's own knowledge of itself (lib/character.ts), and what's
 * visible at a glance (style, a signature item) is what the other character "can see". They flavour the
 * dialogue; they never touch the engine, so editing them changes how future dates sound, never how any date
 * ends. Pure data + zod, no server imports: the builder (a client component) and the API share this file.
 */
import { z } from "zod";
import { LANGUAGE_CODES, type LanguageCode } from "./language";
import {
  ARCHETYPE_IDS,
  archetypeLabel,
  DRAWN_TO_IDS,
  DRAWN_TO_MAX,
  goalLabel,
  GOAL_IDS,
  KIND_IDS,
  KIND_LABEL_MAX,
  kindLabel,
  kindWords,
  type ArchetypeId,
  type GoalId,
  type KindId,
} from "./kinds";
import { LOOK_STEPS, LooksInput, normaliseLooks, publicLooks, type Looks } from "./looks";
import { PROMPT_ANSWER_MAX } from "./field-limits";

export const STAR_SIGNS = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
  "Doesn't believe in it",
] as const;

export const LOVE_LANGUAGES = ["Words of affirmation", "Quality time", "Gifts", "Acts of service", "Physical touch"] as const;

/** Hinge-style profile prompts: a creator picks up to three and answers them. */
export const PROFILE_PROMPTS = [
  { id: "win_me_over", label: "The way to win me over is…" },
  { id: "irrational_fear", label: "My most irrational fear…" },
  { id: "weirdly_attracted", label: "I'm weirdly attracted to…" },
  { id: "two_truths", label: "Two truths and a lie…" },
  { id: "simple_pleasures", label: "My simple pleasures…" },
  { id: "fall_for_you", label: "I'll fall for you if…" },
  { id: "dating_me_is_like", label: "Dating me is like…" },
  { id: "geek_out", label: "I geek out on…" },
  { id: "worst_first_date", label: "My worst first-date story…" },
  { id: "shower_thought", label: "A shower thought I recently had…" },
  { id: "together_we_could", label: "Together, we could…" },
  { id: "unpopular_opinion", label: "My most unpopular opinion…" },
] as const;
export type PromptId = (typeof PROFILE_PROMPTS)[number]["id"];
const PROMPT_IDS = PROFILE_PROMPTS.map((p) => p.id) as [PromptId, ...PromptId[]];
export const MAX_PROMPTS = 3;
export const MAX_HOBBIES = 5;

/** The free-text details, with their limits and labels (also the order they're shown in). */
export const TEXT_DETAILS = {
  occupation: { label: "Occupation", max: 60 },
  hometown: { label: "Hometown", max: 60 },
  style: { label: "Style", max: 80 },
  signature_item: { label: "Signature item", max: 60 },
  go_to_order: { label: "Go-to order", max: 60 },
  walk_on_music: { label: "Walk-on music", max: 80 },
  quirk: { label: "Quirk", max: 120 },
  catchphrase: { label: "Catchphrase", max: 80 },
  hidden_talent: { label: "Hidden talent", max: 80 },
  pet_peeve: { label: "Pet peeve", max: 80 },
  guilty_pleasure: { label: "Guilty pleasure", max: 80 },
  ideal_first_date: { label: "Ideal first date", max: 120 },
  green_flag: { label: "Green flag", max: 80 },
  red_flag: { label: "Red flag they ignore", max: 80 },
} as const;
export type TextDetail = keyof typeof TEXT_DETAILS;
export const TEXT_DETAIL_KEYS = Object.keys(TEXT_DETAILS) as TextDetail[];

/**
 * Lines in the character's own voice, for moments every date has. The single strongest way to keep a small
 * model in one particular voice is to show it the voice (docs/date-quality.md): the actor matches their rhythm,
 * length and word choice, and the critic (lib/quality.ts) sends back a line that just repeats one.
 */
export const SAMPLE_LINES = [
  { id: "hello", label: "How they say hello" },
  { id: "dodge", label: "How they dodge a question" },
  { id: "flirt", label: "How they flirt (or try to)" },
  { id: "upset", label: "When something goes wrong" },
] as const;
export type SampleLineId = (typeof SAMPLE_LINES)[number]["id"];
export const SAMPLE_LINE_MAX = 140;

/**
 * Tells: a habit that slips out when they feel a certain way. Each act of a date hands the speaking character
 * only the tell that fits how the engine decided that act goes for them (lib/personality.ts), so their
 * personality reacts to the date instead of reciting itself.
 */
export const TELLS = [
  { id: "nervous", label: "When they're nervous, they…" },
  { id: "smitten", label: "When they like someone, they…" },
  { id: "bored", label: "When they're bored, they…" },
  { id: "annoyed", label: "When something annoys them, they…" },
] as const;
export type TellId = (typeof TELLS)[number]["id"];
export const TELL_MAX = 100;

/**
 * Facts: anything else the creator wants the character to have, as a label and a value ("Secretly collects:
 * hotel soap"). Up to MAX_FACTS. Public ones are on the card (and in search and the swipe deck); a private one
 * shapes the character on its dates without ever being shown or said outright, like the soul. A date hands each
 * act only a few (factsForAct), so twenty facts never turn a character into a recited list, and different dates
 * bring out different sides of them. They never touch the engine: how a date ends is never decided by a fact.
 */
export const MAX_FACTS = 20;
export const FACT_LABEL_MAX = 40;
export const FACT_VALUE_MAX = 140;
/** How many facts reach one act of a date. */
export const FACTS_PER_ACT = 3;
export type CharacterFact = { label: string; value: string; private?: true };
/** One-tap starting points for a fact's label in the builder. */
export const FACT_IDEAS = [
  "A fear", "A guilty pleasure", "Their worst habit", "A secret", "Collects", "Can't cook", "Always carries", "Allergic to",
  "Best memory", "Biggest regret", "Would never", "Lucky number", "Childhood nickname", "Hates the sound of", "Dream job",
] as const;

/** Words or phrases the character would never say: the critic sends a line that uses one back. */
export const MAX_NEVER_SAYS = 5;
export const NEVER_SAY_MAX = 40;

const opt = (max: number) => z.string().trim().max(max, `At most ${max} characters.`).optional();
const keyed = <K extends string>(ids: readonly K[], max: number) =>
  z.object(Object.fromEntries(ids.map((id) => [id, opt(max)])) as Record<K, ReturnType<typeof opt>>).strict();
const SAMPLE_LINE_IDS = SAMPLE_LINES.map((l) => l.id);
const TELL_IDS = TELLS.map((t) => t.id);

export const ExtrasInput = z
  .object({
    ...(Object.fromEntries(TEXT_DETAIL_KEYS.map((k) => [k, opt(TEXT_DETAILS[k].max)])) as Record<TextDetail, ReturnType<typeof opt>>),
    star_sign: z.enum(STAR_SIGNS).optional(),
    love_language: z.enum(LOVE_LANGUAGES).optional(),
    /** The language they speak on dates and in texts (lib/language.ts; David, 2026-10-31). Unset: their sheet's, else English. */
    language: z.enum(LANGUAGE_CODES).optional(),
    /** Who they are (lib/kinds.ts): what they are, the type they play, what they're here for, the kinds they're drawn to. */
    kind: z.enum(KIND_IDS).optional(),
    kind_label: z.string().trim().max(KIND_LABEL_MAX, `At most ${KIND_LABEL_MAX} characters.`).optional(),
    archetype: z.enum(ARCHETYPE_IDS).optional(),
    here_for: z.enum(GOAL_IDS).optional(),
    drawn_to: z.array(z.enum(DRAWN_TO_IDS)).max(DRAWN_TO_MAX, `At most ${DRAWN_TO_MAX} kinds.`).optional(),
    hobbies: z.array(z.string().trim().min(1).max(30)).max(MAX_HOBBIES, `At most ${MAX_HOBBIES} hobbies.`).optional(),
    prompts: z
      .array(z.object({ id: z.enum(PROMPT_IDS), answer: z.string().trim().min(1).max(PROMPT_ANSWER_MAX) }))
      .max(MAX_PROMPTS, `At most ${MAX_PROMPTS} prompts.`)
      .optional(),
    lines: keyed(SAMPLE_LINE_IDS, SAMPLE_LINE_MAX).optional(),
    tells: keyed(TELL_IDS, TELL_MAX).optional(),
    never_says: z.array(z.string().trim().min(1).max(NEVER_SAY_MAX)).max(MAX_NEVER_SAYS, `At most ${MAX_NEVER_SAYS}.`).optional(),
    facts: z
      .array(
        z
          .object({
            label: z.string().trim().min(1, "Give the fact a label.").max(FACT_LABEL_MAX, `At most ${FACT_LABEL_MAX} characters.`),
            value: z.string().trim().min(1, "Give the fact a value.").max(FACT_VALUE_MAX, `At most ${FACT_VALUE_MAX} characters.`),
            private: z.boolean().optional(),
          })
          .strict(),
      )
      .max(MAX_FACTS, `At most ${MAX_FACTS} facts.`)
      .optional(),
    /** The looks builder's picks (lib/looks.ts). */
    looks: LooksInput.optional(),
  })
  .strict();
export type ExtrasInputType = z.infer<typeof ExtrasInput>;

/** Stored details: only what was filled in. */
export type CharacterExtras = Partial<Record<TextDetail, string>> & {
  star_sign?: (typeof STAR_SIGNS)[number];
  love_language?: (typeof LOVE_LANGUAGES)[number];
  /** The language they speak on dates and in texts (lib/character.ts speaks). */
  language?: LanguageCode;
  /** What they are (lib/kinds.ts); `kind_label` names an "other" in the owner's words. */
  kind?: KindId;
  kind_label?: string;
  archetype?: ArchetypeId;
  here_for?: GoalId;
  /** The kinds they're drawn to: a small nudge in their swipe deck's order, never a filter. */
  drawn_to?: Exclude<KindId, "other">[];
  hobbies?: string[];
  prompts?: { id: PromptId; answer: string }[];
  /** Sample lines in their voice (see SAMPLE_LINES). */
  lines?: Partial<Record<SampleLineId, string>>;
  /** Their tells (see TELLS). */
  tells?: Partial<Record<TellId, string>>;
  never_says?: string[];
  /** The creator's own facts (see MAX_FACTS); `private: true` keeps one off the card. */
  facts?: CharacterFact[];
  /** The looks builder's picks (lib/looks.ts); `looks.after_dark` is private like a private fact. */
  looks?: Looks;
};

/** Keeps only the filled entries of a keyed group; undefined when none are. */
function filledKeys<K extends string>(ids: readonly K[], group: Partial<Record<K, string | undefined>> | undefined): Partial<Record<K, string>> | undefined {
  const out: Partial<Record<K, string>> = {};
  for (const id of ids) {
    const v = group?.[id]?.trim();
    if (v) out[id] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Drops blanks and duplicates, so an emptied field is removed rather than stored as "". */
export function normaliseExtras(input: ExtrasInputType | null | undefined): CharacterExtras {
  const out: CharacterExtras = {};
  if (!input) return out;
  for (const k of TEXT_DETAIL_KEYS) {
    const v = input[k]?.trim();
    if (v) out[k] = v;
  }
  if (input.star_sign) out.star_sign = input.star_sign;
  if (input.love_language) out.love_language = input.love_language;
  if (input.language) out.language = input.language;
  if (input.kind) out.kind = input.kind;
  // A label only names an "other": with any listed kind it would just contradict it.
  const kindLabelText = input.kind_label?.trim();
  if (input.kind === "other" && kindLabelText) out.kind_label = kindLabelText;
  if (input.archetype) out.archetype = input.archetype;
  if (input.here_for) out.here_for = input.here_for;
  const drawnTo = [...new Set(input.drawn_to ?? [])];
  if (drawnTo.length) out.drawn_to = drawnTo;
  // "Chess" and "chess" are one hobby: the first spelling stays.
  const hobbySeen = new Set<string>();
  const hobbies = (input.hobbies ?? []).map((h) => h.trim()).filter((h) => h && !hobbySeen.has(h.toLowerCase()) && hobbySeen.add(h.toLowerCase()));
  if (hobbies.length) out.hobbies = hobbies;
  const seen = new Set<string>();
  const prompts = (input.prompts ?? []).filter((p) => p.answer.trim() && !seen.has(p.id) && seen.add(p.id));
  if (prompts.length) out.prompts = prompts.map((p) => ({ id: p.id, answer: p.answer.trim() }));
  const lines = filledKeys(SAMPLE_LINE_IDS, input.lines);
  if (lines) out.lines = lines;
  const tells = filledKeys(TELL_IDS, input.tells);
  if (tells) out.tells = tells;
  const lower = new Set<string>();
  const never = (input.never_says ?? []).map((s) => s.trim()).filter((s) => s && !lower.has(s.toLowerCase()) && lower.add(s.toLowerCase()));
  if (never.length) out.never_says = never;
  const factKeys = new Set<string>();
  const facts = (input.facts ?? [])
    .map((f) => ({ label: f.label.trim(), value: f.value.trim(), ...(f.private ? { private: true as const } : {}) }))
    .filter((f) => f.label && f.value && !factKeys.has(`${f.label}|${f.value}`.toLowerCase()) && factKeys.add(`${f.label}|${f.value}`.toLowerCase()))
    .slice(0, MAX_FACTS);
  if (facts.length) out.facts = facts;
  const looks = normaliseLooks(input.looks);
  if (looks) out.looks = looks;
  return out;
}

/** A fact as one line: "Allergic to: coriander". */
export const factLine = (f: Pick<CharacterFact, "label" | "value">): string => `${f.label}: ${f.value}`;

/**
 * The details anyone but the owner may see: everything except private facts. Every view of a character that
 * isn't its owner's (the card, search, the swipe deck, MCP get_character, the other side of a date) goes
 * through this.
 */
export function publicExtras(e: CharacterExtras | null | undefined): CharacterExtras {
  if (!e) return {};
  if (e.looks?.after_dark) {
    const { looks, ...rest } = e;
    const shown = publicLooks(looks);
    return publicExtras(shown ? { ...rest, looks: shown } : rest);
  }
  if (!e.facts?.some((f) => f.private)) return e;
  const { facts, ...rest } = e;
  const shown = facts!.filter((f) => !f.private);
  return shown.length ? { ...rest, facts: shown } : rest;
}

/**
 * The few facts one act of a date hands the character: FACTS_PER_ACT of them, a different few each act, picked
 * from the date's seed so a replay is identical and the next date brings out other ones. Public facts it may
 * bring up; private ones shape what it does and never come out in so many words.
 */
export function factsForAct(e: CharacterExtras | null | undefined, seed: number, act: number): { share: string[]; private: string[] } {
  const facts = e?.facts ?? [];
  if (!facts.length) return { share: [], private: [] };
  const n = Math.min(FACTS_PER_ACT, facts.length);
  const start = (Math.abs(Math.trunc(seed)) + act * n) % facts.length;
  const picked = Array.from({ length: n }, (_, i) => facts[(start + i) % facts.length]);
  return { share: picked.filter((f) => !f.private).map(factLine), private: picked.filter((f) => f.private).map(factLine) };
}

export const hasExtras = (e: CharacterExtras | null | undefined): boolean => Boolean(e && Object.keys(e).length);

/** Every free-text detail, for the content filter (lib/safety.ts checkFields). */
export function extrasFields(e: CharacterExtras): Record<string, string | readonly string[] | undefined> {
  return {
    ...Object.fromEntries(TEXT_DETAIL_KEYS.map((k) => [k, e[k]])),
    kind_label: e.kind_label,
    hobbies: e.hobbies,
    prompts: e.prompts?.map((p) => p.answer),
    lines: e.lines ? Object.values(e.lines) : undefined,
    tells: e.tells ? Object.values(e.tells) : undefined,
    never_says: e.never_says,
    facts: e.facts?.flatMap((f) => [f.label, f.value]),
  };
}

export const promptLabel = (id: string): string => PROFILE_PROMPTS.find((p) => p.id === id)?.label ?? id;
export const sampleLineLabel = (id: string): string => SAMPLE_LINES.find((l) => l.id === id)?.label ?? id;
export const tellLabel = (id: string): string => TELLS.find((t) => t.id === id)?.label ?? id;

/**
 * How the details read to the character itself on a date (its own knowledge; anything it may bring up). The
 * voice kit (sample lines, never-says) and the tells are handed over separately, where they do their job
 * (lib/character.ts, lib/conversation.ts), not as things to talk about.
 */
export function extrasForPrompt(e: CharacterExtras): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of TEXT_DETAIL_KEYS) if (e[k]) out[k] = e[k];
  if (e.star_sign) out.star_sign = e.star_sign;
  if (e.love_language) out.love_language = e.love_language;
  // What they are flavours how they talk (a vampire avoids the garlic bread); a human says nothing new, and neither does
  // an "other" with no words of its own. Drawn-to is left out: it's a deck preference, not something to say on a date.
  const what = e.kind && e.kind !== "human" ? kindWords(e) : null;
  if (what) out.what_you_are = what;
  if (e.archetype) out.archetype = archetypeLabel(e.archetype);
  if (e.here_for) out.here_for = goalLabel(e.here_for);
  if (e.hobbies?.length) out.hobbies = e.hobbies;
  if (e.prompts?.length) out.profile_answers = e.prompts.map((p) => `${promptLabel(p.id)} ${p.answer}`);
  return out;
}

/** The sample lines, labelled for the model ("How they say hello: “…”"), in the order SAMPLE_LINES lists them. */
export function voiceExamples(e: CharacterExtras): string[] {
  return SAMPLE_LINES.filter((l) => e.lines?.[l.id]).map((l) => `${l.label}: ${e.lines![l.id]}`);
}

/* -------------------------------- the dating profile (the swipe deck) -------------------------------- */

/** Ideas for "🎲 Surprise me" in the builder: answers that suit almost anyone, to start a dating profile from. */
export const PROMPT_IDEAS: Partial<Record<PromptId, readonly string[]>> = {
  simple_pleasures: ["The first sip of something hot on a cold morning.", "A window seat and nowhere to be.", "Finding a good song on the wrong radio station."],
  win_me_over: ["Remember one small thing I said, and bring it up later.", "Laugh at my worst joke. Then make a worse one.", "Bring snacks. Share the good ones."],
  geek_out: ["Old maps, and the places on them that don't exist any more.", "The perfect sandwich, structurally.", "Bad films with very good soundtracks."],
  together_we_could: ["Find the city's best late-night snack and argue about it.", "Get lost on purpose and call it the plan.", "Start a very small, very serious book club for two."],
  dating_me_is_like: ["A long walk that turns into a whole day.", "A playlist that keeps surprising you.", "A good mystery: slow start, great ending."],
  fall_for_you: ["You're kind to waiters and honest with me.", "You ask a second question.", "You keep my terrible secret about pineapple on pizza."],
  unpopular_opinion: ["Breakfast for dinner beats dinner.", "The middle seat is fine, actually.", "Rain is the best weather."],
};

/** A character joins the swipe deck (lib/swipes.ts) with a dating profile: this many answered prompts and interests. */
export const PROFILE_MIN_PROMPTS = 2;
export const PROFILE_MIN_INTERESTS = 2;

/** What a character's dating profile still needs before it can join the deck, in words; empty when it's complete. */
export function profileMissing(e: CharacterExtras | null | undefined): string[] {
  const prompts = (e?.prompts ?? []).filter((p) => p.answer?.trim()).length;
  const interests = (e?.hobbies ?? []).filter((h) => h.trim()).length;
  const out: string[] = [];
  if (prompts < PROFILE_MIN_PROMPTS) {
    const n = PROFILE_MIN_PROMPTS - prompts;
    out.push(`${n} more answered profile prompt${n === 1 ? "" : "s"} (extras.prompts)`);
  }
  if (interests < PROFILE_MIN_INTERESTS) {
    const n = PROFILE_MIN_INTERESTS - interests;
    out.push(`${n} more interest${n === 1 ? "" : "s"} (extras.hobbies)`);
  }
  return out;
}

export const profileComplete = (e: CharacterExtras | null | undefined): boolean => profileMissing(e).length === 0;

/** What the other character can see at a glance: only the visible details. */
export function extrasVisible(e: CharacterExtras): string[] {
  // A robot or a ghost is plain to see across the table; "human" goes without saying, and an unlabelled "other" has
  // nothing to see ("is a something else" isn't a description).
  const what = e.kind && e.kind !== "human" ? (kindWords(e)?.toLowerCase() ?? null) : null;
  return [
    what ? `is ${/^[aeiou]/.test(what) ? "an" : "a"} ${what}` : null,
    e.style ? `dressed: ${e.style}` : null,
    e.signature_item ? `has ${e.signature_item.replace(/^(A|An|The)\b/, (w) => w.toLowerCase())}` : null,
  ].filter((s): s is string => Boolean(s));
}

/** Text worth searching (lib/dating.ts): everything public (private facts never). */
export function extrasText(e: CharacterExtras): string {
  return [
    ...(publicExtras(e).facts ?? []).map(factLine),
    ...TEXT_DETAIL_KEYS.map((k) => e[k] ?? ""),
    // So a search for "vampire" or "the drifter" finds them.
    kindLabel(e)?.replace(/^\S+\s/, "") ?? "",
    archetypeLabel(e.archetype) ?? "",
    ...(e.hobbies ?? []),
    ...(e.prompts ?? []).map((p) => p.answer),
    ...Object.values(e.lines ?? {}),
    ...Object.values(e.tells ?? {}),
  ].join(" ");
}

/** The details as a JSON Schema (draft-07 compatible), for /character.schema.json and the MCP tools. */
export function extrasJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    description:
      "Optional details that make a date specific: what they do, where they're from, how they dress, hobbies, quirks, up to three profile prompts, the voice kit and up to 20 facts. All optional and public, except facts marked private. They shape the dialogue, never the outcome.",
    properties: {
      ...Object.fromEntries(TEXT_DETAIL_KEYS.map((k) => [k, { type: "string", maxLength: TEXT_DETAILS[k].max, description: TEXT_DETAILS[k].label }])),
      star_sign: { type: "string", enum: [...STAR_SIGNS] },
      love_language: { type: "string", enum: [...LOVE_LANGUAGES] },
      language: {
        type: "string",
        enum: [...LANGUAGE_CODES],
        description: "The language they speak on dates and in texts (es Spanish, fr French, ja Japanese…). Unset: the language their sheet is written in, else English. After Dark is English-only for now.",
      },
      kind: { type: "string", enum: [...KIND_IDS], description: "What they are. Use other with kind_label for anything not listed." },
      kind_label: { type: "string", maxLength: KIND_LABEL_MAX, description: "What an other is, in your words (only with kind: other)." },
      archetype: { type: "string", enum: [...ARCHETYPE_IDS], description: "The type they play: the show's house archetypes." },
      here_for: { type: "string", enum: [...GOAL_IDS], description: "What they're here for." },
      drawn_to: {
        type: "array",
        items: { type: "string", enum: [...DRAWN_TO_IDS] },
        maxItems: DRAWN_TO_MAX,
        uniqueItems: true,
        description: "Kinds they're drawn to: nudges their swipe deck's order, never filters it.",
      },
      hobbies: { type: "array", items: { type: "string", maxLength: 30 }, maxItems: MAX_HOBBIES },
      prompts: {
        type: "array",
        maxItems: MAX_PROMPTS,
        description: `Profile prompts, answered in the character's voice. Prompt ids: ${PROFILE_PROMPTS.map((p) => `${p.id} ("${p.label}")`).join(", ")}.`,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "answer"],
          properties: { id: { type: "string", enum: PROFILE_PROMPTS.map((p) => p.id) }, answer: { type: "string", maxLength: PROMPT_ANSWER_MAX } },
        },
      },
      lines: {
        type: "object",
        additionalProperties: false,
        description:
          "Sample lines in the character's own voice — the strongest way to make their dates sound like them. The model matches their rhythm and word choice, and never repeats one word for word.",
        properties: Object.fromEntries(SAMPLE_LINES.map((l) => [l.id, { type: "string", maxLength: SAMPLE_LINE_MAX, description: l.label }])),
      },
      tells: {
        type: "object",
        additionalProperties: false,
        description:
          "Habits that slip out when they feel a certain way. Each act of a date surfaces the one that fits how the date is going for them (nervous at first, then smitten, bored or annoyed).",
        properties: Object.fromEntries(TELLS.map((t) => [t.id, { type: "string", maxLength: TELL_MAX, description: t.label }])),
      },
      never_says: {
        type: "array",
        maxItems: MAX_NEVER_SAYS,
        items: { type: "string", maxLength: NEVER_SAY_MAX },
        description: "Words or phrases they'd never say. A line that uses one is sent back for a rewrite.",
      },
      facts: {
        type: "array",
        maxItems: MAX_FACTS,
        description:
          `Up to ${MAX_FACTS} facts of your own, each a label and a value ("Allergic to" / "coriander", "Secretly collects" / "hotel soap"). ` +
          "Public by default (shown on the card and in search); private: true keeps one to the character itself (it shapes them on " +
          "dates and is never shown or said outright). A date brings out a few per act, never all at once. They never change how a date ends.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "value"],
          properties: {
            label: { type: "string", maxLength: FACT_LABEL_MAX },
            value: { type: "string", maxLength: FACT_VALUE_MAX },
            private: { type: "boolean", description: "true: only the character and its owner ever see it." },
          },
        },
      },
      looks: {
        type: "object",
        additionalProperties: false,
        description:
          "How they look, picked from fixed options (the /create looks builder): it writes their appearance line and their portrait. Pick a gender first; bust is for women, facial_hair for men.",
        properties: {
          ...Object.fromEntries(
            LOOK_STEPS.filter((st) => !st.afterDark && st.id !== "age").map((st) => [
              st.id,
              { type: "string", enum: [...new Set([...st.options, ...(st.optionsMan ?? [])].map((o) => o.id))] },
            ]),
          ),
          age: { type: "integer", minimum: 18, maximum: 60, description: "The age they look (their sheet's age is separate)." },
        },
      },
    },
  };
}

/* ------------------------------------- 🎲 suggestions for the builder ------------------------------------- */

/** Fun, original, rule-safe ideas the builder's dice draw from (only ever into blank fields). */
export const SUGGESTIONS: Partial<Record<TextDetail | "hobbies", readonly string[]>> = {
  occupation: [
    "Lighthouse keeper", "Competitive cheese judge", "Night-shift museum guard", "Ferris wheel mechanic", "Professional apologizer for a theme park",
    "Cloud-shape consultant", "Fortune-cookie writer", "Ghost-tour guide who's scared of the dark", "Escape-room designer", "Zamboni driver",
    "Retired mime, now a podcaster", "Bespoke umbrella maker", "Hot-air balloon pilot", "Crossword constructor", "Train-station piano tuner",
  ],
  // Lower-case starts: the card reads "from <hometown>".
  hometown: [
    "a fishing village with one traffic light", "a desert town with a famous diner", "a city where it always seems to be raining", "a mountain hamlet famous for goats",
    "an island you can walk around in an hour", "a suburb that peaked in 1987", "a canal town full of bicycles", "somewhere with excellent bakeries",
  ],
  style: [
    "Thrifted cardigans and mismatched socks", "All black, one loud pair of shoes", "Linen everything, permanently creased", "Vintage suits two sizes too big",
    "Outdoor gear for a hike that never happens", "Pastels and a tote bag full of snacks", "Sharp blazer, sneakers, zero regrets",
  ],
  signature_item: [
    "a yellow raincoat", "a pocket watch that runs four minutes fast", "one enormous ring", "a bucket hat in every weather", "a fountain pen", "a thermos of soup",
    "a vintage camera", "a scarf longer than they are",
  ],
  go_to_order: [
    "Whatever the bartender is proudest of", "Two desserts, no main", "The spiciest thing on the menu", "Tea, extremely specific instructions", "Fries for the table",
  ],
  walk_on_music: [
    "A kazoo cover of a sea shanty", "Dramatic organ chords", "Lo-fi beats and rain sounds", "A marching band at half speed", "A one-person theremin solo",
  ],
  quirk: [
    "Narrates their own life in the third person when nervous", "Names every houseplant after a retired detective", "Keeps a ranked list of the city's best benches",
    "Can't walk past a dog without saying hello", "Collects free hotel pens, cross-referenced by city", "Answers questions with a different question",
  ],
  catchphrase: ["“That's a problem for future me.”", "“Let's make it weird.”", "“Bold of you to assume I have a plan.”", "“Say less.”", "“Hold that thought — snack break.”"],
  hidden_talent: [
    "Can identify any bird by its call", "Juggles, but only fruit", "Perfect handstand, terrible landing", "Can fold a fitted sheet", "Remembers every phone number they've ever seen",
  ],
  pet_peeve: ["People who clap when the plane lands", "Lukewarm tea", "Reply-all", "Chewing with confidence", "Stopping at the top of escalators"],
  guilty_pleasure: ["Reality TV with the volume all the way up", "Breakfast for dinner, every night", "Reading the last page first", "Karaoke alone in the car", "Online quizzes about which bread they are"],
  ideal_first_date: [
    "A night market with too many snacks", "Mini golf, competitively", "A long walk that accidentally becomes a short hike", "Stargazing with a thermos", "A cooking class where both are bad at it",
  ],
  green_flag: ["Tips well", "Remembers small details", "Laughs at their own jokes", "Asks follow-up questions", "Kind to waiters"],
  red_flag: ["Has opinions about fonts", "Owns a gong", "Rehearses arguments in the shower", "Says “literally” figuratively", "Brings a laminated itinerary"],
  hobbies: ["Birdwatching", "Pottery", "Bouldering", "Karaoke", "Baking", "Chess", "Night swimming", "Board games", "Thrifting", "Tarot", "Gardening", "Stargazing", "Roller skating"],
};

/** Starting points for the sample lines: meant to be rewritten in the character's own voice. */
export const LINE_SUGGESTIONS: Record<SampleLineId, readonly string[]> = {
  hello: [
    "Oh good, you're real. I had a small bet with myself.", "Hi. I've already decided I like your shoes, so the pressure's on me.",
    "You found it! Most people walk past this place twice.", "Hello. I'm told I'm better after the first ten minutes.",
  ],
  dodge: [
    "Great question. Next question.", "Ask me that again after dessert.", "That's classified, but I'll trade you for a secret.",
    "Mm. Tell me yours first.",
  ],
  flirt: [
    "You have very trustworthy eyebrows.", "I'd split a dessert with you, and I never split dessert.", "Careful, I'm starting to have a nice time.",
    "Is it hot in here, or is that just the soup?",
  ],
  upset: [
    "Cool. Cool cool cool. This is fine.", "Right. Well. That's going in the diary.", "I'm going to need a minute and possibly a snack.",
    "Okay, new plan: we pretend that didn't happen.",
  ],
};

/** Starting points for the tells. */
export const TELL_SUGGESTIONS: Record<TellId, readonly string[]> = {
  nervous: ["over-explain the menu", "fold their napkin into tiny squares", "narrate what they're doing", "laugh a beat too early", "check the time without reading it"],
  smitten: ["start finishing your sentences, badly", "go quiet and grin at the table", "suddenly remember every fact you've said", "offer you the last bite"],
  bored: ["rearrange the sugar packets by colour", "start counting ceiling tiles out loud", "ask the waiter questions instead", "answer with one word"],
  annoyed: ["get extremely, terrifyingly polite", "repeat your last word back as a question", "smile with only their mouth", "start tidying the table"],
};

/** Ideas for things a character would never say. */
export const NEVER_SAY_SUGGESTIONS: readonly string[] = [
  "no worries", "it is what it is", "per my last email", "I'm not like other people", "let's circle back", "calm down", "vibes", "literally",
];

/** A deterministic pick when a seed is given (tests), else random. */
export function suggest(key: keyof typeof SUGGESTIONS, seed?: number): string {
  return pickFrom(SUGGESTIONS[key] ?? [], seed);
}

/** A pick from any suggestion list: deterministic with a seed, else random. */
export function pickFrom(list: readonly string[], seed?: number): string {
  if (!list.length) return "";
  const i = seed === undefined ? Math.floor(Math.random() * list.length) : Math.abs(seed) % list.length;
  return list[i];
}
