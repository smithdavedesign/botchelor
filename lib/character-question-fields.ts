/**
 * "The character asks you the rest" (2026-11-15, with one-sentence create): what a character may ask its owner about its
 * own sheet, the words it asks in, how an answer lands on the sheet, and the answer box the thread shows. The pure half
 * of lib/character-questions.ts: no database and no server imports, so the thread's page, lib/companion.ts (the view) and
 * the tests share it, and lib/companion.ts never has to import the module that imports it back.
 *
 * Only fields a date actually reads (lib/extras.ts extrasForPrompt hands the text details, the interests and the profile
 * answers to the character's own prompt; lib/character.ts shows the model its hello line), and only while they are empty
 * or were written by the show rather than the owner (lib/profile-fill.ts fills two profile answers and two interests
 * from the sheet when a first character is created). Everything here is a template: $0, no model call.
 */
import { MAX_HOBBIES, MAX_PROMPTS, SAMPLE_LINE_MAX, TEXT_DETAILS, type CharacterExtras } from "./extras";
import { PROMPT_ANSWER_MAX } from "./field-limits";
import { fillProfile, promptsFromSheet } from "./profile-fill";

/** In the order they're asked: the job first (it dresses them and opens most dates), then what the show guessed. */
export const QUESTION_FIELDS = ["occupation", "hobbies", "ideal_first_date", "hometown", "dating_me_is_like", "go_to_order", "pet_peeve", "hello"] as const;
export type QuestionField = (typeof QUESTION_FIELDS)[number];
export const isQuestionField = (f: unknown): f is QuestionField => typeof f === "string" && (QUESTION_FIELDS as readonly string[]).includes(f);

/** At most this many questions to one owner about one character, ever. */
export const MAX_QUESTIONS = 5;
/** One a day: the daily job runs once every 24 hours, so "a day" is counted a little short of that. */
export const QUESTION_GAP_HOURS = 20;
/** Two in a row with no answer, and it never asks again. */
export const UNANSWERED_STOP = 2;

/** CHARACTER_QUESTIONS: on unless it is "0" (then the daily job sends none; a box already in a thread still saves). */
export function characterQuestionsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.CHARACTER_QUESTIONS?.trim() !== "0";
}

/**
 * What companion_messages.offers holds for a question: the offer kind `answer` and the field it is about; `taken` once
 * the owner answered; `stopped` on the last one asked when two in a row went unanswered (then nothing more is ever sent).
 * The date chips (lib/companion-offers.ts StoredOffers) are told apart by their episode_id, which this never has.
 */
export type StoredQuestion = {
  kinds: ["answer"];
  field: QuestionField;
  taken?: { kind: "answer"; at: string };
  stopped?: true;
};

export function isStoredQuestion(o: unknown): o is StoredQuestion {
  if (!o || typeof o !== "object") return false;
  const q = o as { kinds?: unknown; field?: unknown };
  return Array.isArray(q.kinds) && q.kinds.length === 1 && q.kinds[0] === "answer" && isQuestionField(q.field);
}

/** The tag a question is kept under (companion_messages.action; a thread gets each field's question once). */
export const questionTag = (field: QuestionField): string => `question:${field}`;
export const QUESTION_TAG_LIKE = "question:%";

type Spec = {
  /** What the answer box is for, in the owner's words ("Their job"). */
  label: string;
  placeholder: string;
  /** The longest answer the sheet takes for it (the box's limit; the edit route is the judge). */
  max: number;
  /** The question, in the character's voice: one bubble, so the box sits right under it. */
  ask: string;
  /** The thanks once it's saved: `said` is the answer, tidied for quoting, or null when it is too long to say back. */
  ack: (said: string | null) => string[];
};

const HOBBY_MAX = 30;
const PLAIN_ACK = ["Got it. That does sound like me.", "I'll take it with me on the next date."];

export const QUESTIONS: Record<QuestionField, Spec> = {
  occupation: {
    label: "Their job",
    placeholder: "Lighthouse keeper",
    max: TEXT_DETAILS.occupation.max,
    ask: "Random question. What do I do for work? I feel like I should know.",
    ack: (a) => (a ? [`${a}. Of course. That explains a lot about me.`] : PLAIN_ACK),
  },
  hobbies: {
    label: "What they do for fun (two or three things)",
    placeholder: "Night swims, bad karaoke",
    max: MAX_HOBBIES * HOBBY_MAX + (MAX_HOBBIES - 1) * 2,
    ask: "Be honest with me. What do I actually do for fun? Two or three things.",
    ack: (a) => (a ? [`${a}. Good. Now I've got something to talk about.`] : PLAIN_ACK),
  },
  ideal_first_date: {
    label: "Their ideal first date",
    placeholder: "A long walk that ends somewhere odd",
    max: TEXT_DETAILS.ideal_first_date.max,
    ask: "Help me out. If it were up to me, what would my ideal first date be?",
    ack: (a) => (a ? [`${a}. Yes. I'd say yes to that.`] : PLAIN_ACK),
  },
  hometown: {
    label: "Where they're from",
    placeholder: "Lisbon",
    max: TEXT_DETAILS.hometown.max,
    ask: "Odd thing to ask, I know. Where am I from?",
    ack: (a) => (a ? [`${a}. I knew that. Mostly.`] : PLAIN_ACK),
  },
  dating_me_is_like: {
    label: "Dating them is like…",
    placeholder: "A long walk that turns into a whole day",
    max: PROMPT_ANSWER_MAX,
    ask: "Finish this one for me. Dating me is like… what?",
    ack: (a) => (a ? [`${a}. That's going on my profile, word for word.`] : PLAIN_ACK),
  },
  go_to_order: {
    label: "What they always order",
    placeholder: "Black coffee and whatever's left in the pastry case",
    max: TEXT_DETAILS.go_to_order.max,
    ask: "Quick one. What do I always order? I keep staring at menus.",
    ack: (a) => (a ? [`${a}. Every time, apparently. Noted.`] : PLAIN_ACK),
  },
  pet_peeve: {
    label: "Their pet peeve",
    placeholder: "People who whistle indoors",
    max: TEXT_DETAILS.pet_peeve.max,
    ask: "What's my pet peeve? I'd like to know before somebody does it.",
    ack: (a) => (a ? [`${a}. Ugh, yes. I'll watch for it.`] : PLAIN_ACK),
  },
  hello: {
    label: "How they say hello",
    placeholder: "You're on time. I like that.",
    max: SAMPLE_LINE_MAX,
    ask: "How do I say hello? Give me the line and I'll use it.",
    ack: () => ["Got it. That's how I'll open from now on.", "Thanks for the line."],
  },
};

/** The answer as the character says it back: trimmed, no closing full stop, a capital first; null past 60 characters. */
export function saidBack(answer: string): string | null {
  const a = answer.replace(/\s+/g, " ").trim().replace(/[.!?…]+$/, "");
  if (!a || a.length > 60) return null;
  return a[0].toUpperCase() + a.slice(1);
}

/** What the lines are: the question for a field, and the thanks for an answer (pure, for the sender and the tests). */
export const questionLines = (field: QuestionField): string[] => [QUESTIONS[field].ask];
export const ackLines = (field: QuestionField, answer: string): string[] => QUESTIONS[field].ack(saidBack(answer));
export const plainAckLines = (): string[] => [...PLAIN_ACK];

/** The part of a character a question reads: its details and the sheet the show's own fill was made from. */
export type QuestionSheet = { extras: CharacterExtras | null | undefined; traits: readonly string[]; want: string };

/**
 * Where a field stands (pure): `empty`, `auto` (exactly what lib/profile-fill.ts writes from this sheet, so the show's
 * guess and nobody's words) or `filled` (the owner's own, never asked about and never replaced). An interest list or a
 * profile answer that differs from the fill by a single character counts as theirs.
 */
export function fieldState(c: QuestionSheet, field: QuestionField): "empty" | "auto" | "filled" {
  const e = c.extras ?? {};
  const sheet = { traits: c.traits, want: c.want };
  switch (field) {
    case "hobbies": {
      const have = (e.hobbies ?? []).map((h) => h.trim()).filter(Boolean);
      if (!have.length) return "empty";
      const filled = fillProfile({ ...e, hobbies: [] }, sheet).hobbies ?? [];
      return JSON.stringify(have) === JSON.stringify(filled) ? "auto" : "filled";
    }
    case "dating_me_is_like": {
      const prompts = (e.prompts ?? []).filter((p) => p.answer?.trim());
      const mine = prompts.find((p) => p.id === "dating_me_is_like");
      // No room for another answer: the profile is the owner's, full, and there is nothing to ask.
      if (!mine) return prompts.length < MAX_PROMPTS ? "empty" : "filled";
      const auto = promptsFromSheet(sheet).find((p) => p.id === "dating_me_is_like")?.answer;
      return auto !== undefined && mine.answer.trim() === auto ? "auto" : "filled";
    }
    case "hello":
      return e.lines?.hello?.trim() ? "filled" : "empty";
    default:
      return e[field]?.trim() ? "filled" : "empty";
  }
}

/** The next field to ask about (pure): the first, in order, that is still empty or the show's own, and not asked yet. */
export function nextQuestion(c: QuestionSheet, asked: readonly string[]): QuestionField | null {
  return QUESTION_FIELDS.find((f) => !asked.includes(f) && fieldState(c, f) !== "filled") ?? null;
}

/** A typed list of interests, as items: split on commas, semicolons, new lines, "and" and "&"; each once. */
export function hobbiesFrom(answer: string): string[] {
  const seen = new Set<string>();
  return answer
    .split(/[,;\n]|\s+&\s+|\s+and\s+/i)
    .map((h) => h.replace(/^[\s\-•*"']+|[\s."'!]+$/g, "").trim())
    .filter((h) => h && !seen.has(h.toLowerCase()) && seen.add(h.toLowerCase()));
}

/**
 * The details with the answer in (pure), or null when the sheet has no room for it any more (the owner filled the
 * profile's three answers since the question was asked). The show's own fill is replaced; anything the owner wrote
 * since is kept, with the answer added beside it. Nothing here checks the answer: the edit route does.
 */
export function withAnswer(c: QuestionSheet, field: QuestionField, answer: string): CharacterExtras | null {
  const e: CharacterExtras = { ...(c.extras ?? {}) };
  const text = answer.replace(/\s+/g, " ").trim();
  switch (field) {
    case "hobbies": {
      const said = hobbiesFrom(text);
      const kept = fieldState(c, "hobbies") === "filled" ? (e.hobbies ?? []) : [];
      const lower = new Set(kept.map((h) => h.toLowerCase()));
      return { ...e, hobbies: [...kept, ...said.filter((h) => !lower.has(h.toLowerCase()))] };
    }
    case "dating_me_is_like": {
      const prompts = [...(e.prompts ?? [])];
      const at = prompts.findIndex((p) => p.id === "dating_me_is_like");
      if (at >= 0) prompts[at] = { id: "dating_me_is_like", answer: text };
      else if (prompts.length < MAX_PROMPTS) prompts.push({ id: "dating_me_is_like", answer: text });
      else return null;
      return { ...e, prompts };
    }
    case "hello":
      return { ...e, lines: { ...(e.lines ?? {}), hello: text } };
    default:
      return { ...e, [field]: text };
  }
}

/** The box under a question, as the thread's page gets it (lib/companion-shared.ts CompanionQuestionView). */
export type QuestionView = { field: QuestionField; label: string; placeholder: string; max: number };

export const questionView = (field: QuestionField): QuestionView => ({ field, label: QUESTIONS[field].label, placeholder: QUESTIONS[field].placeholder, max: QUESTIONS[field].max });

/**
 * The one question whose answer box shows (pure, for lib/companion.ts getThread): the newest question in the thread,
 * while it has no answer. An older unanswered one has no box: the conversation moved on, and its field can be asked
 * about again from the sheet. Null when there is none.
 */
export function openQuestion(messages: readonly { id: string; role: string; offers: unknown }[]): { messageId: string; view: QuestionView } | null {
  const newest = [...messages].reverse().find((m) => m.role === "character" && isStoredQuestion(m.offers));
  if (!newest) return null;
  const q = newest.offers as StoredQuestion;
  return q.taken ? null : { messageId: newest.id, view: questionView(q.field) };
}
