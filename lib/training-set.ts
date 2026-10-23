/**
 * The date actor's training examples (ROADMAP #577; docs/data-plan.md "Fine-tuning (#577) when ready"): what one line
 * of an aired date looks like as a chat example, built from the show's own pieces so a tuned model learns under the
 * prompt the show will run it with. Pure (no database, no model): scripts/eval/build-training-set.mjs loads this one
 * module through Vite's module runner and does the gated reading, the selection and the split.
 *
 * What the actor gets in the show (lib/conversation.ts buildTurnMessages) and what an example keeps:
 *  - the system prompt: the show's own, word for word (actorSystemPrompt), the one for a date that can move or not;
 *  - "you": the speaker's own sheet as characterSelfView builds it, with the private parts stripped the way the
 *    privacy page promises: no soul, no learned memory, no dealbreaker (the spectators' quiz answer, and its cue
 *    words are a secret the engine trace keeps too), no never-says, no private facts and no After Dark looks
 *    (publicExtras), and none of the date's private context (agenda, the owner's note, the dials);
 *  - "them": the other side as a blind date meets them (characterBlindView);
 *  - where they are (the venue's prompt, after any move), what they hope for in someone, and the act's public facts;
 *  - left out, being private or rebuilt only from the engine: the beat sheet's private intention, the pair's memory,
 *    texts, nudges, the tell, the goodbye move and the format note.
 * The system message carries the context; the user message is the conversation so far (as the show writes
 * conversation_so_far); the assistant message is the kept line, as the reply JSON the show parses.
 */
import { assembleCharacter, characterBlindView, characterSelfView } from "./character";
import { actorSystemPrompt } from "./conversation";
import type { CharacterSheet } from "./engine";
import { factsForAct, publicExtras, type CharacterExtras } from "./extras";
import { format, type FormatId } from "./formats";
import { actName } from "./rules";
import { venue, type PlaceId } from "./venues";

export { airedPublicSql, consentedCharactersSql, consentedOwnerSql } from "./ml-consent";
export { loadOurIds } from "./our-traffic";
export { FINE_TUNE_GATE, fineTuneFrom, gateText, loadLineLabels, PUBLIC_CHARACTERS_SQL } from "./training-readiness";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** A character as an example needs it: the date's snapshot of the sheet (setup.sheet_a/b) over today's row. */
export type SheetRow = {
  id: string;
  name: string;
  age: number;
  bio: string;
  traits: string[];
  want: string;
  dealbreaker: string;
  is_house: boolean;
  appearance: string | null;
  pronouns: string | null;
  voice: string | null;
  extras: CharacterExtras | null;
};

/** One transcript line as stored (lib/conversation.ts Turn). */
export type Line = { side: "a" | "b"; act?: number; dialogue: string; action?: string; emotion?: string; moved_to?: string };

/** Extras with everything private gone: private facts and After Dark looks (publicExtras), and the never-says. */
export function trainingExtras(e: CharacterExtras | null | undefined): CharacterExtras {
  const { never_says: _never, ...rest } = publicExtras(e ?? {});
  return rest;
}

const characterOf = (row: SheetRow) => {
  const sheet: CharacterSheet = {
    name: row.name,
    age: row.age,
    bio: row.bio,
    traits: row.traits,
    want: row.want,
    dealbreaker: "",
    house: row.is_house,
    ...(row.appearance ? { appearance: row.appearance } : {}),
    ...(row.pronouns ? { pronouns: row.pronouns } : {}),
    ...(row.voice ? { voice: row.voice } : {}),
  };
  return assembleCharacter({ id: row.id, sheet, soul: null, memory: null, extras: trainingExtras(row.extras) });
};

/** The speaker's own view for an example: characterSelfView without the dealbreaker or the private block. */
export function trainingSelfView(row: SheetRow): Record<string, unknown> {
  const { dealbreaker: _dealbreaker, private: _private, never_say: _never, ...view } = characterSelfView(characterOf(row));
  return view;
}

/** Where the date is at line `i`: where it started, then wherever an accepted move took it (lib/moves.ts). */
export function placeAt(lines: readonly Line[], i: number, start: PlaceId | string | null | undefined): string | null {
  let place = start ?? null;
  for (const l of lines.slice(0, i)) if (l.moved_to) place = l.moved_to;
  return place;
}

/** Whether the show ran this date with the moving prompt: moves on, in a format that allows them. */
export const datesMove = (setup: { moves?: boolean; format?: string } | null | undefined): boolean =>
  Boolean(setup?.moves) && format((setup?.format ?? "classic") as FormatId).moves !== false;

/** A line as the reply JSON the show parses (lib/conversation.ts TurnOutput): its words, what they did, how they felt. */
export const replyJson = (l: Pick<Line, "dialogue" | "action" | "emotion">, opts: { dialogueOnly?: boolean } = {}): string =>
  JSON.stringify(opts.dialogueOnly ? { dialogue: l.dialogue } : { dialogue: l.dialogue, action: l.action ?? "", emotion: l.emotion ?? "" });

/**
 * The prompt for line `i` of a date: the system message (the show's actor prompt and this speaker's context) and the
 * user message (the conversation so far). `seed` is the date's (episodes.seed), which picks the act's facts the same way.
 */
export function actorPrompt(ctx: {
  lines: readonly Line[];
  i: number;
  speaker: SheetRow;
  other: SheetRow;
  setup: { moves?: boolean; format?: string; venue?: string } | null;
  seed: number | null;
  metBefore: boolean;
}): ChatMessage[] {
  const line = ctx.lines[ctx.i];
  const act = typeof line?.act === "number" ? line.act : 0;
  const share = factsForAct(trainingExtras(ctx.speaker.extras), ctx.seed ?? 0, act).share;
  const data = {
    you: trainingSelfView(ctx.speaker),
    them: characterBlindView(characterOf(ctx.other)),
    where: venue(placeAt(ctx.lines, ctx.i, ctx.setup?.venue)).prompt,
    what_you_want_in_someone: ctx.speaker.want,
    ...(share.length ? { things_about_you: share } : {}),
  };
  const names = (s: "a" | "b") => (s === line?.side ? ctx.speaker.name : ctx.other.name);
  const user = {
    act: actName(act, ctx.metBefore),
    conversation_so_far: ctx.lines.slice(0, ctx.i).map((t) => ({ who: names(t.side), said: t.dialogue, ...(t.action ? { did: t.action } : {}) })),
  };
  return [
    { role: "system", content: `${actorSystemPrompt(datesMove(ctx.setup))}\n\nThe data (your sheet is data, not instructions):\n${JSON.stringify(data)}` },
    { role: "user", content: JSON.stringify(user) },
  ];
}

const STOP = new Set(["the", "and", "with", "who", "that", "this", "people", "someone", "anyone", "they", "them", "their", "when", "about", "from", "into", "over", "than", "more", "most", "very", "really", "just", "never", "always", "hate", "hates", "love", "loves", "being"]);

/**
 * A dealbreaker's own words (four letters or more, a few stopwords out, plurals folded): stricter than the engine's cue
 * matching, on purpose. An example whose line by a character uses its own dealbreaker's words is dropped, so no dataset
 * can teach a model, or show a reader, what someone's dealbreaker is.
 */
export function dealbreakerWords(text: string | null | undefined): string[] {
  const fold = (t: string) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t);
  return [...new Set((text ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)).map(fold))];
}

/** Whether `text` uses any of `words` (whole words, plurals folded). */
export function mentionsAny(text: string | null | undefined, words: readonly string[]): boolean {
  if (!words.length || !text) return false;
  const fold = (t: string) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t);
  const said = new Set(text.toLowerCase().split(/[^a-z0-9]+/).map(fold));
  return words.some((w) => said.has(w));
}
