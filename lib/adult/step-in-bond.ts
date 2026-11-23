/**
 * How well the viewer and one character know each other in Step in: a level with a name, worked out from what they've
 * actually done together. David, 2026-11-23: "A visible relationship level (SpicyChat, Candy), without the decay and
 * paid skips people complain about."
 *
 * What the field does (docs/audits/2026-11-23-scenes-and-side-pictures.md, row 10): SpicyChat shows meters at the top of
 * the chat; Candy has levels and XP. What people complain about there: levels that decay when you're away (a Linky
 * user's intimacy fell from 6 to near zero after a week), and paying to skip one. So this one is built the other way:
 *
 *  - **It's derived, not asked for.** Nothing is entered and nothing is earned by pressing a button: it's read from
 *    rows that already exist (the lines the viewer wrote, the days they wrote them on, the scenes, the roleplays played
 *    to the end, calls, pictures, what the character remembers).
 *  - **Time together matters most.** A day with a line in it is worth ten; a story played to the end twelve; a line a
 *    quarter of a point, and only the first 24 of a day count. Everything that could be repeated in one sitting is
 *    capped a day (BOND_WORTH), so the most a single day can add (BOND_DAY_MAX) is under the second threshold: a first
 *    evening reaches level 2 and no evening, however long, jumps two levels.
 *  - **It never drops.** A person who deletes a scene takes its lines with it, so the derived number can fall. The
 *    most it has ever been is kept per viewer and character (adult_step_in_bonds, lib/adult/step-in-bond-data.ts) and
 *    the greater of the two is what's shown. Only deleting their After Dark data takes it away.
 *  - **It's felt, not only shown.** One line in the character's own prompt says how long the two have known each other
 *    (bondPromptLine), so the tenth evening isn't greeted like the first. It is never leave to go faster or further:
 *    the line says so itself, and the pace, the limits and the will rules stand as written.
 *
 * What it is not, since the next person will be tempted: no decay, no streaks, no daily rewards, nothing unlocked or
 * locked by a level, nothing about it for sale (a picture costs tokens past the month's own, so pictures count for a
 * day at most once, two points: nobody buys a level), no notification, and nothing on the show's host.
 *
 * Pure and client-safe: the rows are lib/adult/step-in-bond-data.ts's.
 */

/** The levels, lowest first: where each starts, and its name (plain words, a capital only at the start). */
export const BOND_LEVELS = [
  { at: 0, name: "Strangers" },
  { at: 12, name: "Acquainted" },
  { at: 60, name: "Familiar" },
  { at: 150, name: "At ease" },
  { at: 320, name: "Close" },
  { at: 600, name: "Confidants" },
] as const;

/**
 * What each thing is worth, and how much of it counts in a day (UTC's day: nobody's time zone is known here).
 *  - a day with at least one line of the viewer's in a scene with them;
 *  - their lines: four to a point, the first `linesADay` of a day;
 *  - a scene they wrote in, counted on the day of its first line, `scenesADay` at most;
 *  - a roleplay played to its last beat (lib/adult/step-in-story.ts), `storiesADay` at most;
 *  - a day with a call in it, and a day with a picture made in it: once each, however many;
 *  - what the character remembers about them (lib/adult/step-in-memory.ts): a point a thing, `factsMax` at most ever.
 */
export const BOND_WORTH = {
  day: 10,
  linesToAPoint: 4,
  linesADay: 24,
  scene: 2,
  scenesADay: 2,
  story: 12,
  storiesADay: 2,
  callDay: 3,
  pictureDay: 2,
  fact: 1,
  factsMax: 10,
} as const;

/** The most one day can add, with everything in it and the memory's whole share: kept under the third level's start. */
export const BOND_DAY_MAX =
  BOND_WORTH.day +
  Math.floor(BOND_WORTH.linesADay / BOND_WORTH.linesToAPoint) +
  BOND_WORTH.scene * BOND_WORTH.scenesADay +
  BOND_WORTH.story * BOND_WORTH.storiesADay +
  BOND_WORTH.callDay +
  BOND_WORTH.pictureDay +
  BOND_WORTH.fact * BOND_WORTH.factsMax;

/** What the two have done together, as it's counted for the level (each already held to its day's cap). */
export type BondCounted = {
  /** Days with a line of the viewer's. */
  days: number;
  /** Their lines, each day's held to linesADay. */
  lines: number;
  /** Scenes they wrote in, each day's held to scenesADay. */
  scenes: number;
  /** Roleplays played to the end, each day's held to storiesADay. */
  stories: number;
  /** Days with a call, and days with a picture made. */
  callDays: number;
  pictureDays: number;
  /** Things the character remembers about them. */
  facts: number;
};

/** What the two have done together, as a person would say it: the real totals, nothing capped. */
export type BondSince = { days: number; lines: number; scenes: number; stories: number; calls: number; pictures: number; facts: number };

export const NO_BOND_SINCE: BondSince = { days: 0, lines: 0, scenes: 0, stories: 0, calls: 0, pictures: 0, facts: 0 };

/** The points for what's counted. Whole numbers; nothing in here goes down as more is done. */
export function bondPoints(c: BondCounted): number {
  const w = BOND_WORTH;
  return (
    c.days * w.day +
    Math.floor(c.lines / w.linesToAPoint) +
    c.scenes * w.scene +
    c.stories * w.story +
    c.callDays * w.callDay +
    c.pictureDays * w.pictureDay +
    Math.min(c.facts, w.factsMax) * w.fact
  );
}

/** The level (from 1) those points reach. */
export function bondLevel(points: number): number {
  let level = 1;
  for (let i = 1; i < BOND_LEVELS.length; i++) if (points >= BOND_LEVELS[i].at) level = i + 1;
  return level;
}

export const bondName = (level: number): string => BOND_LEVELS[Math.min(BOND_LEVELS.length, Math.max(1, level)) - 1].name;

/** A level's name inside a sentence ("You and Juniper are now at ease."). */
export const bondNameInSentence = (level: number): string => bondName(level).toLowerCase();

/** What the viewer is shown of it. */
export type StepInBond = {
  level: number;
  name: string;
  points: number;
  /** The next level and where it starts; null at the top. */
  next: { name: string; at: number } | null;
  /** How far toward the next, 0 to 1 (1 at the top). */
  progress: number;
  /** What it's made of: the real totals of what's there now. */
  since: BondSince;
  /** It stands on more than what's there now: scenes since deleted still count (it never drops). */
  kept: boolean;
  /** This level was reached just now: the scene says so once, under the reply. */
  reached: boolean;
};

/** The small mark a list shows beside a character: nothing below level 2 (strangers have no mark). */
export type BondMark = { level: number; name: string };

/**
 * The level as it's shown: the greater of what's derived now and the most it has ever been (`stored`), so it never
 * drops. `reached` is the caller's to say (lib/adult/step-in.ts: once, on the reply that crossed into it).
 */
export function bondView(derived: number, stored: number, since: BondSince, reached = false): StepInBond {
  const points = Math.max(0, Math.floor(derived), Math.floor(stored));
  const level = bondLevel(points);
  const here = BOND_LEVELS[level - 1];
  const next = BOND_LEVELS[level] ?? null;
  return {
    level,
    name: here.name,
    points,
    next: next ? { name: next.name, at: next.at } : null,
    progress: next ? Math.min(1, Math.max(0, (points - here.at) / (next.at - here.at))) : 1,
    since,
    kept: Math.floor(stored) > Math.floor(derived),
    reached,
  };
}

export const bondMark = (points: number): BondMark | null => {
  const level = bondLevel(points);
  return level > 1 ? { level, name: bondName(level) } : null;
};

const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * What it's made of, in a few words, the things that matter most first ("4 evenings · 2 stories played · 61 lines").
 * Only what there is; nothing at all for a pair with nothing done.
 */
export function bondSinceWords(s: BondSince): string[] {
  return [
    s.days ? count(s.days, "evening", "evenings") : "",
    s.stories ? `${count(s.stories, "story", "stories")} played` : "",
    s.scenes ? count(s.scenes, "scene", "scenes") : "",
    s.lines ? count(s.lines, "line", "lines") : "",
    s.calls ? count(s.calls, "call", "calls") : "",
    s.pictures ? count(s.pictures, "picture", "pictures") : "",
    s.facts ? count(s.facts, "thing remembered", "things remembered") : "",
  ].filter(Boolean);
}

/** What the scene says, once, when a reply crosses into a level. */
export const bondReachedLine = (firstName: string, level: number): string => `You and ${firstName} are now ${bondNameInSentence(level)}.`;

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const inWords = (n: number) => NUMBER_WORDS[n] ?? String(n);

/** How each level reads to the character: what the time together has made of the two, never what it permits. */
const BOND_FEELS: Record<number, string> = {
  2: "you've met before and you remember them; you don't start from nothing",
  3: "you're familiar with each other: you know how they talk, and there's a joke or two between you",
  4: "you're at ease with them: you have history, and you don't act as if you've just met",
  5: "you're close: you know their habits and they know yours, and the ease between you shows",
  6: "you know each other very well by now: you trust them, and they have trusted you",
};

/** Said in every bond line: time together is never leave. Tests hold the pace rules to this wording. */
export const BOND_NEVER_FASTER =
  "This is how well you know each other, and never a reason to go faster or further than they take things: the pace, their limits and your own will stand exactly as written.";

/**
 * The one line the character's prompt gets about it (lib/adult/step-in-prompt.ts), from the level and the facts behind
 * it. Null for strangers, and null through a first scene on a first evening (the first line of all already makes the
 * two acquainted on the page, but nothing came before it, so the character is told nothing): a first scene is written
 * exactly as it always was. From the second scene or the second evening on, it says how long they've known each other.
 */
export function bondPromptLine(bond: Pick<StepInBond, "level" | "since" | "kept">, o: { roleplay?: boolean } = {}): string | null {
  const feels = BOND_FEELS[Math.min(bond.level, BOND_LEVELS.length)];
  if (bond.level < 2 || !feels) return null;
  const { days, scenes, stories } = bond.since;
  if (!bond.kept && days < 2 && scenes < 2) return null;
  const spent = days >= 2 ? `You two have spent ${inWords(days)} evenings together` : "You two have spent time together before";
  const played = stories > 0 ? ` and played ${inWords(stories)} ${stories === 1 ? "story" : "stories"} to the end` : "";
  return `${spent}${played}: ${feels}. ${BOND_NEVER_FASTER}${o.roleplay ? " In a roleplay the role comes first; this is who the two of you are underneath it." : ""}`;
}

/**
 * A list of characters with the viewer's own people first (After Dark's Characters page): whoever has written to them
 * and is waiting for an answer, then whoever they have a scene running with, then by how well they know each other,
 * the highest level first. Everyone else, and everyone within a group who is level with another, keeps the order the
 * list came in. Someone who has never stepped in gets the list back as it was.
 */
export function yourPeopleFirst<C extends { id: string }>(list: readonly C[], yours: { wrote: ReadonlySet<string>; running: ReadonlySet<string>; level: (id: string) => number }): C[] {
  // Three groups (a note waiting, a scene running, neither), and inside each the higher level first; level 1 is nobody yet.
  const rank = (c: C) => (yours.wrote.has(c.id) ? 0 : yours.running.has(c.id) ? 10 : 20) - Math.min(9, Math.max(0, yours.level(c.id) - 1));
  return list.map((c, i) => ({ c, i, r: rank(c) })).sort((x, y) => x.r - y.r || x.i - y.i).map((x) => x.c);
}
