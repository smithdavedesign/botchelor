/**
 * The turn: the one moment, in the middle of a date, that its decided ending comes from (2026-11-16,
 * docs/date-quality.md "Round: endings the dialogue earns").
 *
 * The engine decides how a date ends before a word is spoken (lib/engine.ts), and the rules plan (lib/beats.ts) tells
 * each actor where each act takes them. That wasn't enough for the endings that go badly: a decided disaster played warm
 * to its last line and then ended (an eval's judge scored those dates 2.0 of 5 for "is the ending earned?"), because
 * "by the end of this act something in you has started to cool" names a feeling and no cause. Two agreeable actors find
 * no reason to cool, so they don't.
 *
 * So the plan now carries the cause as something that happens on the page: a few consecutive lines a third of the way
 * in (one sets it up, one does it, one takes it), and where that leaves each of them for every line after. It is built
 * here by rules, from what each side's prompt may already see and nothing else:
 *   - a dealbreaker the engine says was tripped (the side it tripped for reacts to its own dealbreaker; the other is
 *     never told what it is);
 *   - something one of them has heard about the other (its own story state, lib/story-state.ts): raised to their face;
 *   - an agenda the engine says didn't pay off (the side whose agenda it is makes the opening; the other does the
 *     thing that fails it, as its beat always asked, now on one line);
 *   - two opinions that collide (each side's own hot take, lib/hot-takes.ts);
 *   - a want the engine says went unmet (the side whose want it is tests for it).
 * A date that ends "just friends" turns on a friend's line: one of them says the thing you only say to a friend, and
 * both hear that it's true. A date that ends well and had an agenda miss gets a small wobble that is met and let go.
 * No model call.
 *
 * What it never does: decide anything. The outcome is read, never written; the turn exists only on a plan written by the
 * rules for a date the show's own model plays whole (lib/pipeline.ts), behind EARNED_ENDINGS. The characters' own answers
 * (lib/choices.ts) are asked afterwards exactly as before.
 */
import { AGENDA_CAUSES, type DatePlan, type DateTurn } from "./beats";
import type { Character } from "./character";
import type { DateInput, Outcome } from "./engine";
import { collidingTakes } from "./hot-takes";
import type { AgendaId } from "./rules";
import { bringable, type Heard } from "./story-state";
import { shortName } from "./names";

type Env = Record<string, string | undefined>;

/**
 * EARNED_ENDINGS: "0" off, "1" on; unset, the default below. On, by the eval's own rule (docs/date-quality.md, "Round:
 * endings the dialogue earns"; 12 dates an arm on the show's model): over the seven dates that end badly the judge's
 * "motivated" rose from 2.57 to 3.43 (the four disasters 2.25 to 3.5; every one that scored 2 or less scored 3 or 4),
 * and "natural" went from 3.43 to 3.21, inside what two runs of the very same prompts differ by (a point, on four of
 * five such pairs). "0" plays every date from its beats alone, exactly as before.
 */
export const EARNED_ENDINGS_DEFAULT = true;
export function earnedEndingsOn(env: Env = process.env): boolean {
  const v = env.EARNED_ENDINGS?.trim();
  return v === "1" ? true : v === "0" ? false : EARNED_ENDINGS_DEFAULT;
}

type Side = 0 | 1;
const letter = (s: Side): "a" | "b" => (s === 0 ? "a" : "b");
const other = (s: Side): Side => (s === 0 ? 1 : 0);

/**
 * The lines an unmet agenda turns on: the opening its owner makes (private to them: it is their own aim), what the other
 * does with it (behaviour only, as lib/beats.ts AGENDA_CAUSES has always put it: they are never told why it matters),
 * and what that was to the owner.
 */
const AGENDA_TURN: Record<AgendaId, { setup: string; miss: string; land: string }> = {
  find_adventurous: {
    setup: "Put a spontaneous idea to them on this line: something the two of you could go and do, tonight or soon, a little reckless and straight out of your own life. Mean it, and leave it with them.",
    miss: 'They\'ve just put an idea to you. It isn\'t for you, and you say so on this line: turn it down plainly, as yourself, with your real reason. No "maybe another time", and no joke to soften it.',
    land: "You offered an adventure and they turned it down. You'd been quietly hoping they'd jump at it.",
  },
  test_sincerity: {
    setup: "Ask them one real question on this line, the kind a joke can't answer: something you actually need to know about them. Ask it straight, then leave them room.",
    miss: "They've just asked you something real. You don't answer it on this line: you slide past it with a bit, a joke or a story, the way you do when a question gets close. Stay with the bit; don't come back to the real answer.",
    land: "You asked a real question and got a routine. That was the thing you'd come to find out about them.",
  },
  find_funny: {
    setup: "Hand them an opening on this line: tease them a little, or set up something a funny person would run with. You want to be made to laugh tonight.",
    miss: "Go for the laugh on this line: a bit you're pleased with, from your own life, pushed a beat further than it should go.",
    land: "That was their big swing at being funny, and it didn't make you laugh. You can't pretend it did.",
  },
  avoid_work_talk: {
    setup: "Steer the two of you well away from jobs on this line: ask about something they do for no reason at all.",
    miss: "Bring it back to your work on this line, in detail: the thing from the job you can't put down. You haven't noticed they'd moved off it.",
    land: "You'd steered away from work and they went straight back to theirs. Tonight was meant to be about anything else.",
  },
  keep_it_light: {
    setup: "Keep it playful on this line: something silly and easy, an invitation to stay there with you.",
    miss: "Take it somewhere heavy on this line: something that really weighs on you, said plainly, though the mood was light. You don't check whether they want it.",
    land: "You wanted tonight easy, and it just got heavy. That isn't what you came for.",
  },
  out_of_comfort_zone: {
    setup: "Reach for something new on this line: suggest the two of you try a thing neither of you would normally do, here or straight after. It costs you some nerve to say.",
    miss: "They've suggested something unfamiliar. You'd rather not, and you say so on this line as yourself: keep to what you know. No half-yes.",
    land: "You worked up the nerve to try something new, and they kept it safe.",
  },
};

/** How a missed agenda lands, by where the date is going: a blow, or a doubt that will be met. */
const LANDS: Record<"disaster" | "second_date", string> = {
  disaster: " Let it land on this line, your way: a flatter answer, the subject dropped, or saying so. Don't laugh it off and don't talk them round.",
  second_date: " It gives you a moment's real doubt. Let it show on this line; don't pretend it didn't happen.",
};

/** Where the moment leaves a side for the rest of the night, by the ending and whether the engine says it wants more. */
function afterFor(outcome: Outcome, s: Side, on: Side): string {
  const wants = outcome.sides[s].wants_another;
  if (outcome.ending === "friends") {
    return wants
      ? "Since that moment it's settled for you, without anyone needing to say it: this is a friendship, not a romance. Be easy company (tease, tell stories, laugh). No flirting, and no talk of another date."
      : "Since that moment you know it isn't a romance, and you're not looking for more than tonight. Be pleasant, be kind, and make no plans.";
  }
  if (wants) return "Since that moment it has been going wrong, and you can feel it. Part of you still wants to pull it back: one honest try at most, which doesn't work. You don't pretend things are fine.";
  return s === on
    ? "Since that moment you've cooled toward them, and it doesn't come back tonight: shorter answers, no new questions about their life, no plans together. Stay civil and stay yourself. Don't explain it, and don't make up."
    : "Since that moment the ease between you has gone, and you've stopped trying to get it back. You don't apologise for who you are and you don't chase them: your own interest has dropped with theirs. No rescuing the mood, no invitations.";
}

/** The side the engine's drama names as put off: the one who leaves first, or the one who turns the other down. */
function putOff(outcome: Outcome): Side | null {
  if (outcome.drama_answer === "neither") return null;
  const named: Side = outcome.drama_answer === "a" ? 0 : 1;
  return outcome.drama_question === "leaves_first" ? named : other(named);
}

/** Of the sides a rule could turn on, the one the drama names, else the one the date's seed picks. */
function pick(sides: Side[], outcome: Outcome): Side | null {
  if (!sides.length) return null;
  const drama = putOff(outcome);
  if (drama !== null && sides.includes(drama)) return drama;
  return sides[(outcome.seed ?? 0) % sides.length];
}

const step = (s: Side, note: string) => ({ side: letter(s), note });

/** What this side has heard about the other that it could raise: its own story state, never used before, told by someone first. */
function heardAbout(c: Character): { heard: Heard; n: number } | null {
  const list = bringable(c.story);
  const i = Math.max(0, list.findIndex((h) => h.told_by_name));
  return list[i] ? { heard: list[i], n: i + 1 } : null;
}

/**
 * The turn for a date, or null when it has none (a date that ends well with nothing in the facts to wobble on). Pure:
 * the same date gets the same turn, and nothing here touches the outcome.
 */
export function turnFor(input: DateInput, outcome: Outcome, characters: [Character, Character]): DateTurn | null {
  const sides = [input.a, input.b] as const;
  const both: Side[] = [0, 1];
  const missed = both.filter((s) => !outcome.sides[s].agenda_met);
  const withAfter = (kind: DateTurn["kind"], on: Side, steps: DateTurn["steps"]): DateTurn => ({ kind, on: letter(on), steps, after: { a: afterFor(outcome, 0, on), b: afterFor(outcome, 1, on) } });
  const agendaTurn = (on: Side, ending: "disaster" | "second_date"): DateTurn["steps"] => {
    const t = AGENDA_TURN[sides[on].agendaId];
    return [step(on, t.setup), step(other(on), t.miss), step(on, t.land + LANDS[ending])];
  };

  if (outcome.ending === "second_date") {
    // A date that ends well: only when the engine says an agenda missed, and then it is met and let go.
    const on = pick(missed, outcome);
    if (on === null) return null;
    return {
      kind: "wobble",
      on: letter(on),
      steps: [
        ...agendaTurn(on, "second_date"),
        step(other(on), "Something you just did landed wrong with them, and you felt it. Meet it on this line: own it honestly, in your own way, without grovelling or explaining it away."),
        step(on, "They met you honestly. Let the doubt go on this line, and let it show that you like them more for how they handled it."),
      ],
    };
  }

  if (outcome.ending === "friends") {
    // "Just friends" isn't a date that went wrong, so it doesn't turn on a miss: one of them says a friend's thing, and
    // both hear it. (The first version turned it on a missed agenda, gently. Measured, that showed the miss and still
    // never said why it wasn't a romance: 4 -> 3 and 3 -> 3 for "motivated", against 2 -> 4 for the friend's line.)
    // Said by the one the facts say was let down (an agenda that missed), else by the one the date's seed picks.
    const says: Side = pick(missed, outcome) ?? ((outcome.seed ?? 0) % 2 === 0 ? 0 : 1);
    return withAfter("friends", other(says), [
      step(says, "Say the thing you'd only say to a friend, on this line and warmly: who you'd love them to meet, the mate they remind you of, a favour you'd ask a pal. You mean it as a compliment."),
      step(other(says), "That was a friend's line, and you notice it's true for you as well: whatever this is, it isn't romance. Let it land lightly on this line: a laugh at the two of you, more relief than hurt."),
    ]);
  }

  // A disaster. First what the engine itself names: a dealbreaker that was tripped.
  const tripped = pick(both.filter((s) => outcome.sides[s].dealbreaker_hit), outcome);
  if (tripped !== null) {
    return withAfter("dealbreaker", tripped, [
      step(other(tripped), "On this line you're entirely yourself, unguarded: the side of you that people either love or can't take comes out in full, in something you say or do. You don't soften it."),
      step(tripped, `Something in how they just were is the one thing you can't stand ("${characters[tripped].dealbreaker}"). It shows on this line before you can stop it: say so, or go cold, your way.`),
      step(other(tripped), "They've gone cold at something that is simply you. You don't apologise for it. Hold your ground on this line, a little stung."),
    ]);
  }
  // Then something one of them heard about the other, raised to their face.
  const heardBy = pick(both.filter((s) => heardAbout(characters[s])), outcome);
  if (heardBy !== null) {
    const { heard, n } = heardAbout(characters[heardBy])!;
    const from = heard.told_by_name ? `what ${shortName(heard.told_by_name)} told you about them` : "what you heard about them";
    return withAfter("heard", heardBy, [
      step(heardBy, `Bring up ${from}, on this line and to their face: "${heard.claim}" Say where you heard it, and ask whether it's true. It has been on your mind all night, and how they answer matters to you. (When "what_youve_heard_about_them" is in your data it is number ${n} there: put ${n} in "brought_up".)`),
      step(other(heardBy), "They've just repeated something that's being said about you, and asked you to account for it. It stings to be discussed behind your back and put on trial at dinner. Answer on this line as yourself, as you see it; you don't owe them reassurance, and you let them see that it stung."),
      step(heardBy, "Their answer doesn't settle it for you: how they took it told you as much as what they said. Let that show on this line. You don't take the question back and you don't smooth it over."),
    ]);
  }
  // Then an agenda the engine says didn't pay off.
  const agendaOn = pick(missed, outcome);
  if (agendaOn !== null) return withAfter("agenda", agendaOn, agendaTurn(agendaOn, "disaster"));
  // Then two opinions that collide: each says its own.
  const clash = collidingTakes(characters[0].hotTakes ?? [], characters[1].hotTakes ?? []);
  if (clash) {
    const on = pick(both, outcome)!;
    return withAfter("takes", on, [
      step(other(on), `Say what you really think on this line: "${clash[other(on)]}" State it flat, as a plain fact about the world, not as a question.`),
      step(on, `You hold the opposite, and this one matters to you: "${clash[on]}" Say so on this line and stand on it. You're not being agreeable about this.`),
      step(other(on), "Neither of you is backing down, and it has stopped being banter. Dig in on this line, a little sharper than you meant to be."),
    ]);
  }
  // Last, a want the engine says went unmet: its owner tests for it, and the answer isn't the one.
  const wantOn = pick(both.filter((s) => !outcome.sides[s].want_met), outcome) ?? pick(both, outcome)!;
  const want = characters[wantOn].persona.want;
  return withAfter("want", wantOn, [
    step(wantOn, `Find out on this line whether they are what you're hoping for ("${want}"): ask the question, or try the small thing, that would tell you. About something real, never in those words.`),
    step(other(wantOn), "They've just asked or tried something that matters to them more than they're letting on. Your honest answer isn't the one they're hoping for. Give it on this line as yourself, plainly; don't guess what they want to hear and don't adjust it to please them."),
    step(wantOn, `That wasn't it: they are not "${want}". Let it land on this line, your way: a flatter answer, something in you closing. Don't argue them into it.`),
  ]);
}

/**
 * A rules plan with the date's turn on it, or the plan as it is when the date has none. When the turn pins an agenda's
 * miss to a line, the act beat's "at some point this act, you…" for that same behaviour is dropped, so it happens once.
 */
export function withTurn(plan: DatePlan, input: DateInput, outcome: Outcome, characters: [Character, Character]): DatePlan {
  const turn = turnFor(input, outcome, characters);
  if (!turn) return plan;
  if (turn.kind !== "agenda" && turn.kind !== "wobble") return { ...plan, turn };
  const owner = turn.on === "a" ? input.a : input.b;
  const doer = turn.on === "a" ? "b" : "a";
  const vague = `At some point this act, you ${AGENDA_CAUSES[owner.agendaId].missed}. `;
  const acts = plan.acts.map((act) => ({ ...act, [doer]: act[doer].replace(vague, "") })) as DatePlan["acts"];
  return { ...plan, acts, turn };
}

/**
 * The line a turn starts on, in a date planned for `total` lines: the line of its first speaker nearest a third of the
 * way in, never the opening line, and early enough that a line is left after it (two after a wobble, which must be over
 * before the goodbye). Null when the date is too short to hold it; the date then plays from its beats alone.
 */
export function turnStart(turn: DateTurn, total: number): number | null {
  const first = turn.steps[0]?.side;
  if (!first) return null;
  const left = turn.after ? 1 : 2;
  const target = total / 3;
  let best: number | null = null;
  for (let i = first === "a" ? 2 : 1; i + turn.steps.length <= total - left; i += 2) {
    if (best === null || Math.abs(i - target) <= Math.abs(best - target)) best = i;
  }
  return best;
}

/**
 * What a turn adds to one line's prompt: "this_moment" on the lines of the moment (that speaker's own note), and
 * "since_then" on every line after it. Nothing before it, and nothing for a side on the other's line.
 */
export function turnNote(turn: DateTurn | undefined, index: number, total: number, side: "a" | "b"): { this_moment?: string; since_then?: string } {
  if (!turn) return {};
  const start = turnStart(turn, total);
  if (start === null || index < start) return {};
  const at = turn.steps[index - start];
  if (at) return at.side === side ? { this_moment: at.note } : {};
  return turn.after ? { since_then: turn.after[side] } : {};
}
