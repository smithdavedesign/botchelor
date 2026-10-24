/**
 * Where a date is heading, in plain words (MCP 2.11.0, #656). All three visitors of two runs in a row were surprised that a
 * warm-reading date ended in a disaster: "the ending is predetermined, so my writing felt decorative". David's call
 * (2026-10-22): on a date agents perform themselves, every performer sees from its first step which way the engine has it
 * heading (the direction the last act's act_note gave before), with the two or three things that matter most for this pair,
 * so the lines can play toward it and the audience sees lines that fit the ending. Owners can already read their own
 * endings once a date is written (#261 hides them only while it's being written), so this tells a performer nothing it
 * wouldn't learn; only performers see it (lib/own-date.ts load()), never the audience, and performers can't predict their
 * own dates (app/api/predictions/route.ts).
 *
 * Qualitative words only: the box score's numbers aren't shown during the date, so a number is a level (low, middling,
 * high), and the reason behind it comes from the engine's own terms (lib/engine.ts EngineTrace), never a secret cue word.
 * The same words name a disaster's weak spot in its why (lib/why.ts) and the reflect_on_date hint.
 */
import { endingScore, marks, NEUTRAL_START, type EngineTrace, type Outcome, type SideOutcome } from "./engine";
import { DATE_VARIABLES, DEFAULT_STRATEGY, endingLabel, WISH_LIFT_NEAR, type DateVariable, type Ending, type Strategy } from "./rules";

/** Each box-score number in plain words, during the date and after it. */
export const PLAIN: Record<DateVariable, { now: string; past: string }> = {
  chemistry: { now: "the spark between them", past: "the spark between them" },
  attraction: { now: "how drawn they are to each other", past: "how drawn they were to each other" },
  trust: { now: "how safe they feel opening up", past: "how safe they felt opening up" },
  awkwardness: { now: "how stiff it gets", past: "how stiff it got" },
};

/** How a number reads in the lines, when it works against the date (low; awkwardness: high) and when it works for it. */
export const IN_LINES: Record<DateVariable, { against: string; for: string }> = {
  chemistry: { against: "talk that never quite catches: polite, a beat late", for: "easy laughter, each picking up the other's jokes" },
  attraction: { against: "interest that doesn't land: no leaning in, attention drifting", for: "leaning in, noticing each other" },
  trust: { against: "guarded answers and a question dodged", for: "something true said, and taken well" },
  awkwardness: { against: "pauses, crossed wires and a joke that misses", for: "a conversation that flows" },
};

/** What each of the engine's terms is, in words that name the pair, never one side's private soul or a cue word. */
const TERM_WORDS: Record<string, string> = {
  traits: "the traits they share",
  humor: "their sense of humour",
  warmth: "their warmth",
  budget: "the night's budget",
  strategy: "how the date is played",
  note: "the notes their owners left them",
  dealbreakers: "a tripped dealbreaker",
  history: "how their last date went",
  familiarity: "having met before",
  openness: "how open they are",
  wants: "a want met",
  agendas: "their agendas landing",
  guarded: "how guarded they are",
  clashes: "clashing agendas",
  jitter: "the luck of the night",
};

/** A number as a level, never the number (the box score shows those once the date is written). */
function level(v: DateVariable, n: number): string {
  if (v === "awkwardness") return n >= 60 ? "high" : n >= 48 ? "noticeable" : n >= 35 ? "mild" : "barely there";
  return n >= 65 ? "high" : n >= 55 ? "good" : n >= 45 ? "middling" : n >= 35 ? "low" : "very low";
}

type Box = Partial<Record<DateVariable, { final: number }>>;
/** How much each number pulls the date up (+) or down (-) against an ordinary first date, as the date's strategy weighs it. */
export type Pull = { v: DateVariable; final: number; pull: number };

/**
 * The four numbers' pulls, most helpful first (lib/engine.ts endingScore: the same weights decide the ending). `version`:
 * the date's engine version (v4 weighs two strategies differently); left out, v3's weights.
 */
export function pulls(box: Box | null | undefined, strategy: Strategy | null | undefined, version?: number | null): Pull[] {
  if (!box || !DATE_VARIABLES.every((v) => box[v])) return [];
  const finals = Object.fromEntries(DATE_VARIABLES.map((v) => [v, box[v]!.final])) as Record<DateVariable, number>;
  const w = endingScore(strategy ?? DEFAULT_STRATEGY, finals, 0, version ?? 3).weights;
  return DATE_VARIABLES.map((v) => ({ v, final: finals[v], pull: (v === "awkwardness" ? -1 : 1) * w[v] * (finals[v] - NEUTRAL_START[v]) })).sort(
    (x, y) => y.pull - x.pull || DATE_VARIABLES.indexOf(x.v) - DATE_VARIABLES.indexOf(y.v),
  );
}

/** The number that cost the date most (the weak spot), or null without a box score. */
export const weakest = (box: Box | null | undefined, strategy: Strategy | null | undefined, version?: number | null): Pull | null => pulls(box, strategy, version).at(-1) ?? null;

/** What moved a number most, in words, from the engine's trace: what pulled it the way it went. Null without a trace. */
function becauseOf(trace: EngineTrace | null | undefined, v: DateVariable, against: boolean): string | null {
  const terms = trace?.terms?.[v];
  if (!terms) return null;
  // A number working against the date was pulled down by a negative term (awkwardness: pushed up by a positive one).
  const sign = (v === "awkwardness" ? -1 : 1) * (against ? -1 : 1);
  let best: [string, number] | null = null;
  for (const [k, n] of Object.entries(terms)) {
    if (k === "base" || !TERM_WORDS[k]) continue;
    const s = n * sign;
    if (s >= 2 && (!best || s > best[1])) best = [k, s];
  }
  return best ? TERM_WORDS[best[0]] : null;
}

const firstName = (name: string): string => name.split(/\s+/)[0];

/** One number as a factor, in words: "trust (how safe they feel opening up) is low, mostly from how guarded they are". */
function factorLine(p: Pull, trace: EngineTrace | null | undefined): string {
  const because = becauseOf(trace, p.v, p.pull < 0);
  return `${p.v} (${PLAIN[p.v].now}) is ${level(p.v, p.final)}${because ? `, mostly from ${because}` : ""}`;
}

/** How a number plays in the lines: "low trust reads as guarded answers and a question dodged". */
const readsAs = (p: Pull): string => `${level(p.v, p.final)} ${p.v} reads as ${p.pull < 0 ? IN_LINES[p.v].against : IN_LINES[p.v].for}`;

export type Heading = {
  /** The engine's ending as the date stands (each side's see_again on its last line can still tip it). */
  ending: Ending;
  ending_label: string;
  /** The heading in a line: "heading for a disaster: trust is the weak spot". */
  says: string;
  /** The two or three things that matter most for this pair, in words. */
  factors: string[];
  /** What it means for the lines, and the one lever. */
  note: string;
};

/**
 * #728: on a date agents perform under engine v4+, the wishes are a rule (lib/wishes.ts liftEnding), and the heading says
 * it truthfully, by where the date is heading: what both sides' see_again would do to it. `near`: the engine's margin is
 * within WISH_LIFT_NEAR of a second date's mark, so a both-yes lifts friends to a second date.
 */
export function liftLever(ending: Ending, near: boolean, twoAgent = false): { unless: string | null; lever: string } {
  const lever = twoAgent
    ? "Your lever is your side's private see_again on its last line; with theirs: both yes and it can't end in a disaster (and a close friends ending becomes a second date), both no and it can't be a second date, one each and the engine's ending stands."
    : "The lever is each side's private see_again on its last line: both yes and it can't end in a disaster (and a close friends ending becomes a second date), both no and it can't be a second date, one each and the engine's ending stands.";
  const unless =
    ending === "disaster"
      ? "unless you both want to see each other again: both say see_again: true on your last lines and it lifts"
      : ending === "second_date"
        ? "unless neither wants another: both say see_again: false on your last lines and it drops to friends"
        : near
          ? "and close to a second date: both say see_again: true on your last lines and it lifts to one"
          : null;
  return { unless, lever };
}

/** Is a margin close enough to a second date for both yeses to lift a friends ending (lib/wishes.ts liftEnding)? */
export const nearSecondDate = (margin: number | null | undefined, version: number | null | undefined): boolean =>
  typeof margin === "number" && margin >= marks(version).secondDateAt - WISH_LIFT_NEAR;

/**
 * Where a date is heading, for the agents performing it: the engine's ending as booked, said with the two or three factors
 * that matter most for this pair (the numbers that pull hardest the way it went, a tripped dealbreaker first: whose, never on
 * what), and what that means for the lines. `twoAgent`: each agent plays one side, so the lever is its own side's see_again.
 * `dateNumber`: which date this is for the couple (lib/rules dateNumberOf), so a third date is heading for "a fourth date".
 * `version` (#728): the date's engine version. From v4 a tripped dealbreaker is named only when it decides the ending (the
 * trace's dealbreaker_decided), the weakest number leads otherwise, and the heading says what both see_agains would do.
 */
export function dateHeading(
  outcome: Pick<Outcome, "ending" | "variables" | "sides"> & { margin?: number },
  names: readonly [string, string],
  strategy: Strategy | null | undefined,
  trace: EngineTrace | null | undefined,
  twoAgent = false,
  dateNumber?: number | null,
  version?: number | null,
): Heading {
  const ending = outcome.ending;
  const v4 = (version ?? trace?.engine_version ?? 1) >= 4;
  const lead = leadFor(ending, dateNumber);
  const ranked = pulls(outcome.variables, strategy, version ?? trace?.engine_version);
  const tripped = (outcome.sides ?? []).flatMap((s: SideOutcome, i) => (s.dealbreaker_hit ? [firstName(names[i])] : []));
  const tripWords = tripped.length === 2 ? "both their dealbreakers trip" : tripped.length === 1 ? `${tripped[0]}'s dealbreaker trips` : null;
  // v4: the dealbreaker leads only when it decides the ending (the same night without it would end otherwise).
  const decides = !v4 || Boolean(trace?.reasons?.includes("dealbreaker_decided"));
  const dealbreaker = tripWords && decides ? tripWords : null;
  const minor = tripWords && !decides ? tripWords : null;
  const best = ranked[0];
  const worst = ranked.at(-1);
  // Which numbers to name: the ones that pull hardest the way the date is going, two or three (fewer beside a dealbreaker);
  // a friends ending names the best and the worst.
  const room = dealbreaker ? 2 : 3;
  const way = (list: Pull[], goes: (p: Pull) => boolean): Pull[] => {
    const along = list.filter(goes).slice(0, room);
    return along.length >= 2 ? along : list.slice(0, 2);
  };
  const chosen: Pull[] = !ranked.length
    ? []
    : ending === "second_date"
      ? way(ranked, (p) => p.pull > 0)
      : ending === "disaster"
        ? way([...ranked].reverse(), (p) => p.pull < 0)
        : [best!, worst!, ...ranked.slice(1, -1).filter((p) => Math.abs(p.pull) >= 1).sort((x, y) => Math.abs(y.pull) - Math.abs(x.pull))].slice(0, room);
  const factors = [
    ...(dealbreaker && ending !== "second_date" ? [`${dealbreaker} (what on stays private): ${v4 ? "it decides this one" : "the heaviest single cost a date can have"}`] : []),
    ...chosen.map((p) => factorLine(p, trace)),
    ...(dealbreaker && ending === "second_date" ? [`${dealbreaker} (what on stays private), and the rest outweighs it`] : []),
    ...(minor ? [`${minor} (what on stays private): one cost among several, not what decides it`] : []),
  ];
  const lift = v4 ? liftLever(ending, nearSecondDate(outcome.margin, version ?? trace?.engine_version), twoAgent) : null;
  const head = lift?.unless ? `${lead} ${lift.unless}` : lead;
  // Before v4: "heading for a disaster: trust is the weak spot". From v4 the lever comes first, then the factor.
  const why = !best || !worst
    ? null
    : ending === "second_date"
      ? `${best.v} carries it`
      : ending === "friends"
        ? `${best.v} is there, but ${worst.v} never gets going`
        : `${dealbreaker ? `${dealbreaker}, and ` : ""}${worst.v} is the weak spot`;
  const says = !why ? head : lift?.unless ? `${head}. ${cap(why)}` : `${lead}: ${why}`;
  const play = !best || !worst ? null : ending === "second_date" ? readsAs(best) : ending === "disaster" ? readsAs(worst) : `${readsAs(best)}; ${readsAs(worst)}`;
  const lever = lift ? lift.lever : twoAgent ? TWO_AGENT_LEVER : OWN_LEVER;
  return {
    ending,
    ending_label: endingLabel(ending, dateNumber),
    says,
    factors,
    note: v4
      ? `Set at booking from the two characters' numbers: play the lines toward it${play ? ` (${play})` : ""}, or both send see_again to move it. ${lever}`
      : `Set at booking from the two characters' numbers, not from how the lines read: play the lines toward it${play ? ` (${play})` : ""}. ${lever}`,
  };
}
const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
const LEAD: Record<Ending, string> = { second_date: "heading for a second date", friends: "closing as friends", disaster: "heading for a disaster" };
/** The heading's lead for one date: a couple's third date is "heading for a fourth date". */
const leadFor = (ending: Ending, dateNumber?: number | null): string =>
  ending === "second_date" ? `heading for ${endingLabel(ending, dateNumber).toLowerCase()}` : LEAD[ending];
/** The lever, between your own two characters (you send both sides' see_again) and on a two-agent date (your side's only). */
const OWN_LEVER = "The one lever is each side's private see_again on its last line: both yes makes a better ending likelier, both no a parting.";
const TWO_AGENT_LEVER = "Your one lever is your side's private see_again on its last line: with theirs, it can tip it.";
/** The heading as the performer of one side sees it (a two-agent date): the same, with that side's lever. */
export const forTwoAgents = (h: Heading): Heading => {
  const own = liftLever(h.ending, false, false);
  const two = liftLever(h.ending, false, true);
  return { ...h, note: h.note.replace(OWN_LEVER, TWO_AGENT_LEVER).replace(own.lever, two.lever) };
};

/** The heading as one line, for a step's instructions and a reply's top: the line and its factors. */
export const headingLine = (h: Heading): string => `Where it's heading (step.heading): ${h.says} (${h.factors.join("; ")}).`;

/**
 * A disaster's weak spot in plain words, for its why (lib/why.ts): the number that cost it most, as the date's strategy
 * weighs it. Null without a box score.
 */
export function weakSpotLine(box: Box | null | undefined, strategy: Strategy | null | undefined, version?: number | null): string | null {
  const w = weakest(box, strategy, version);
  return w ? `The weak spot was ${w.v}: ${PLAIN[w.v].past}.` : null;
}

/**
 * reflect_on_date's one hint on how the numbers map to the lines (#656, the 2026-10-22-0610 run: "a short 'how the numbers
 * map to your lines' hint"): what set the ending, the number that mattered most this time and how it reads in a line, and
 * what to do with that on the next date. `dateNumber`: which date it was for the couple (lib/rules dateNumberOf).
 */
export function numbersHint(ending: Ending | null | undefined, box: Box | null | undefined, strategy: Strategy | null | undefined, dateNumber?: number | null, version?: number | null): string {
  const ranked = pulls(box, strategy, version);
  const key = !ranked.length ? null : ending === "disaster" || ending === "friends" ? ranked.at(-1)! : ranked[0];
  const which = key
    ? ` This time it was ${key.v} (${PLAIN[key.v].past}), ${key.pull < 0 ? "working against them" : "carrying it"}: in a line, that's ${key.pull < 0 ? IN_LINES[key.v].against : IN_LINES[key.v].for}.`
    : "";
  return (
    `How the numbers map to your lines: the ending${ending ? ` (${endingLabel(ending, dateNumber).toLowerCase()})` : ""} came from the two characters' numbers, set at booking (box_score), never from the lines, which play it.${which} ` +
    "A date you perform names its heading from the first step (heading): write toward it, and send see_again on your character's last line, the one lever."
  );
}
