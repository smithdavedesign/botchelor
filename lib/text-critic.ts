/**
 * The free critic for texts between characters: the morning after (lib/afterglow.ts), the daily texts
 * (lib/between-dates.ts), a person's phone and a house character's reply (lib/texting.ts), and a new match's first
 * texts (lib/swipes.ts). Dates had this critic (lib/conversation.ts critiqueTurn); texts didn't, so a character that
 * held it together on a date opened 11 of 12 texts with "Hello good looking" (Chud × Nell, 2026-10-18).
 *
 * Only the repetition checks apply here: a text that opens like an earlier one, repeats a phrase for the third time,
 * nearly repeats an earlier text, echoes the other's last text, reads out one of the speaker's sample lines, or says
 * something it would never say. The profile checks stay with dates (by the time two characters text, they've met).
 * A flagged text goes back once with the note; the revision is kept only if it parses, so the critic never costs a text.
 */
import type { Character } from "./character";
import type { Turn } from "./conversation";
import type { ChatMessage, Model } from "./model";
import { ModelError } from "./model";
import { shortName } from "./names";
import { lineIssues } from "./quality";
import { textMakesPlan } from "./relationships";
import { checkFieldsAnyLanguage, needsTranslation } from "./language-check";

/** One text in a thread, by the sender's full name (lib/between-dates.ts threadFor). */
export type ThreadText = { from: string; text: string };

const asTurn = (side: "a" | "b", text: string): Turn => ({ side, act: 0, dialogue: text, action: "", emotion: "", interest: 0.5 });

/** The critic's note for one text, or null when it reads fine. `me` wrote it; the thread is everything before it. */
export function critiqueText(thread: readonly ThreadText[], text: string, me: Character, them: Character): string | null {
  const before = thread.map((t) => asTurn(t.from === me.name ? "a" : "b", t.text));
  const issues = lineIssues(before, asTurn("a", text), [me, them]);
  const notes: string[] = [];
  if (issues.repeated_opener) notes.push(`you've started a text with "${issues.repeated_opener}…" before — open differently, or just say the thing`);
  if (issues.catchphrase) notes.push(`"${issues.catchphrase}" is becoming a tic — you've used it in two texts already`);
  if (issues.near_duplicate) notes.push(`that's nearly a text you already sent ("${issues.near_duplicate}") — say something new`);
  if (issues.mirrored_other) notes.push(`you're echoing ${shortName(them.name)}'s last text ("${issues.mirrored_other}") — answer in your own words`);
  if (issues.sample_echo) notes.push("that repeats one of your example lines word for word — say it fresh in the same voice");
  if (issues.never_said) notes.push(`you'd never say "${issues.never_said}" — put it your own way`);
  return notes.length ? notes.join("; ") : null;
}

/** How far back a thread is read for a plan the two already made. */
const PLAN_LOOKBACK = 8;

/**
 * A text that talks about meeting: the relationship graph's plan words (lib/relationships.ts textMakesPlan), plus the
 * replies that confirm one ("Bring your engineering degree", "I can meet you by the east wing", "ready when you are").
 * Wider than the graph's, on purpose: this only decides whether the next text should leave the plan alone.
 */
const CONFIRMS =
  /\b(bring your|meet you|i can meet|i'll meet|i will meet|see you there|ready when you are|ready to go|i'll be there|count me in|sounds like a plan|it's settled)\b/i;
const talksPlan = (text: string): boolean => textMakesPlan(text) || CONFIRMS.test(text);

/**
 * The plan two characters already made by text, when they've both talked about it (two or more of the last few texts
 * make a plan): the latest one. Null otherwise. Tells the next text the plan is settled (Chud × Nell re-proposed
 * "meet me by the east wing" in ten texts running).
 */
export function planAlreadyMade(thread: readonly ThreadText[]): string | null {
  const recent = thread.slice(-PLAN_LOOKBACK).filter((t) => talksPlan(t.text));
  if (recent.length < 2 || new Set(recent.map((t) => t.from)).size < 2) return null;
  return recent[recent.length - 1].text;
}

/** A text, or none and why: the model's last refusal, or null when it answered but no reply had a text in it. */
export type Written = { text: string; error: null } | { text: null; error: ModelError | null };

/**
 * One text from a model, critiqued: two tries for a usable reply, then (if the critic flags it) one revision with the
 * note. The revision is kept only if it parses; otherwise the first draft stands. No text when no usable reply came
 * back, with the reason for whoever asked (a person's phone says it: a 502 there used to leave no trace, 2026-10-29).
 */
export async function writeCritiquedText(
  model: Model,
  messages: ChatMessage[],
  parse: (raw: string) => string | null,
  critique: (text: string) => string | null,
  where: string,
): Promise<Written> {
  let draft: { raw: string; text: string } | null = null;
  let error: ModelError | null = null;
  for (let attempt = 0; attempt < 2 && !draft; attempt++) {
    try {
      const raw = await model.complete(messages, { temperature: 0.9 });
      const text = parse(raw);
      if (text) draft = { raw, text };
    } catch (err) {
      if (err instanceof ModelError) error = err;
      else console.error(`[${where}] model call failed:`, err instanceof Error ? err.message : "unknown");
    }
  }
  if (!draft) {
    console.warn(`[${where}] no text after two tries: ${error ? error.message : "the replies had no text in them"}`);
    return { text: null, error };
  }
  const note = critique(draft.text);
  let text = draft.text;
  if (note) {
    try {
      const revised = parse(
        await model.complete(
          [...messages, { role: "assistant", content: draft.raw }, { role: "user", content: `Revise that text: ${note}. Reply with the JSON again.` }],
          { temperature: 0.9 },
        ),
      );
      text = revised ?? draft.text;
    } catch {
      /* the first draft stands */
    }
  }
  // A text in another language (lib/character.ts speaks): the parser's content filter reads English, so it's read again
  // in English (lib/language-check.ts). One the check can't clear isn't sent.
  if (needsTranslation(text) && !(await checkFieldsAnyLanguage({ text }, { model })).ok) {
    console.warn(`[${where}] a text in another language didn't pass the check in English`);
    return { text: null, error: null };
  }
  return { text, error: null };
}
