/**
 * The mixer as one room (David 2026-11-01: "I would assume a mixer is everyone same room"). Underneath it is still the
 * circle of pairwise speed dates (lib/group-dates-run.ts) — one date per single, and each pair's own episode decides
 * its own ending, so mutual signals, matches, second dates and texts work unchanged. What changes is what each pair
 * knows and what a viewer sees:
 *
 *  - Rounds. The circle's rotations are dealt into rounds the bell calls: in a round every table is a different pair,
 *    so nobody is in two places at once (an even circle takes two rounds; an odd one three, the last a single table
 *    while the others watch from the bar).
 *  - The room line. Each rotation's actors see the whole room in their table line (setup.table → the actor prompt's
 *    also_at_your_table): who's here, which round it is, how the earlier rounds looked from across the room, and the
 *    background beats around their table this round (a laugh at the next table, a wave from the bar).
 *  - The night page (/mixers/[id]). The same beats, the room's opening, the rounds in order with a bell between them,
 *    and one closing beat (who leaves with whom) once every table has aired.
 *
 * Everything here is pure and dealt from the night's id, so the prompt and the page always tell the same room. The
 * opening, beats and closing are written from templates, not a model: the night costs exactly its rotations' lines.
 */
import { seedFrom } from "./engine";
import { shortName } from "./names";
import type { Ending } from "./rules";
import { venuePhrase } from "./venues";

/** One rotation as the room sees it: its two people, its round, and (once booked) its episode. */
export type RoomRotation = { a: string; b: string; round?: number; episode_id?: string | null; failed?: string };

/**
 * Which round the bell calls rotation `i` of an `n`-seat circle in. Rotation i is seat i with seat i+1, so neighbours
 * alternate: even rotations in round 0, odd in round 1 — and an odd circle's closing rotation (seat n-1 with seat 0)
 * touches both, so it gets a round of its own.
 */
export function roundOf(i: number, n: number): number {
  if (n % 2 === 1 && i === n - 1) return 2;
  return i % 2;
}

/** How many rounds an `n`-seat circle takes (2 even, 3 odd; a 2-seat "circle" is one meeting). */
export function roundCount(n: number): number {
  if (n <= 2) return 1;
  return n % 2 === 1 ? 3 : 2;
}

/** The round a stored rotation is in: drawn with it since the room (2026-11-01), dealt from its index before that. */
export function rotationRound(rotations: readonly RoomRotation[], i: number): number {
  const r = rotations[i]?.round;
  if (typeof r === "number") return r;
  return rotations.length <= 2 ? 0 : roundOf(i, rotations.length);
}

/** The rotations' indices in the order the bell plays them: round by round, tables within a round as drawn. */
export function playOrder(rotations: readonly RoomRotation[]): number[] {
  return rotations.map((_, i) => i).sort((x, y) => rotationRound(rotations, x) - rotationRound(rotations, y) || x - y);
}

/** How a table looked from across the room, by its ending: what the others could see, never the verdict itself. */
const LOOKED: Record<Ending, string> = {
  second_date: "leaning in by the bell",
  friends: "easy laughs, nothing more anyone could see",
  disaster: "a table that went quiet early",
};

/** One beat around a table: who, and what the room sees them do. `at` is the line it lands after on the night page. */
export type RoomBeat = { at: number; text: string };

const PAIR_BEATS = [
  (p: string, q: string) => `At the next table, ${p} laughs at something ${q} said.`,
  (p: string, q: string) => `${p} and ${q} lean in over the next table.`,
  (p: string, q: string) => `A burst of laughter from ${p} and ${q}'s table.`,
  (p: string, q: string) => `${q} steals a sip of ${p}'s drink at the next table.`,
];
const BAR_BEATS = [
  (x: string) => `${x} waves from the bar.`,
  (x: string) => `${x} watches from the bar, drink in hand.`,
  (x: string) => `${x} catches someone's eye across the room and looks away first.`,
];

/** Draws an index from a seed string, so the same night always deals the same beats. */
const deal = (key: string, n: number) => seedFrom(key) % n;

/**
 * The beats around rotation `i` this round (at most two): the other tables in its round first, then whoever is sitting
 * this round out at the bar. Dealt from the night, so the actors' prompt and the night page show the same moments.
 */
export function backgroundBeats(nightId: string, rotations: readonly RoomRotation[], i: number, names: ReadonlyMap<string, string>, seatIds: readonly string[]): RoomBeat[] {
  const me = rotations[i];
  if (!me) return [];
  const round = rotationRound(rotations, i);
  const nm = (id: string) => shortName(names.get(id) ?? "someone");
  const others = rotations
    .map((r, j) => ({ r, j }))
    .filter(({ r, j }) => j !== i && rotationRound(rotations, j) === round && !r.failed);
  const busy = new Set([me.a, me.b, ...others.flatMap(({ r }) => [r.a, r.b])]);
  const atBar = seatIds.filter((id) => !busy.has(id));
  const lines: string[] = [];
  for (const { r, j } of others) lines.push(PAIR_BEATS[deal(`${nightId}:${i}:${j}`, PAIR_BEATS.length)](nm(r.a), nm(r.b)));
  for (const id of atBar) lines.push(BAR_BEATS[deal(`${nightId}:${i}:${id}`, BAR_BEATS.length)](nm(id)));
  // Two at most, landing after the second and the fourth of the table's six lines.
  return lines.slice(0, 2).map((text, k) => ({ at: k === 0 ? 2 : 4, text }));
}

/**
 * The room line both actors of rotation `i` see (lib/conversation.ts also_at_your_table): the whole room, the round,
 * how the earlier rounds looked, and the beats around them. Their date is still theirs; the room is the setting.
 * `endings`: the earlier rotations' engine endings by index (booked first, so they're known when this one books).
 */
export function roomLine(opts: {
  nightId: string;
  venue: string;
  rotations: readonly RoomRotation[];
  i: number;
  names: ReadonlyMap<string, string>;
  seatIds: readonly string[];
  endings: ReadonlyMap<number, Ending>;
}): string {
  const { nightId, venue, rotations, i, names, seatIds, endings } = opts;
  const me = rotations[i];
  const nm = (id: string) => shortName(names.get(id) ?? "someone");
  const round = rotationRound(rotations, i);
  const rounds = Math.max(...rotations.map((_, j) => rotationRound(rotations, j))) + 1;
  const room = seatIds
    .filter((id) => id !== me.a && id !== me.b)
    .map(nm);
  const parts = [
    `It's a speed-dating mixer at ${venuePhrase(venue)}, everyone in one room: ${room.join(", ")} ${room.length === 1 ? "is" : "are"} here too.`,
    `The bell pairs people up: this is round ${round + 1} of ${rounds}, six lines with each other before it rings again.`,
  ];
  const earlier = rotations
    .map((r, j) => ({ r, j }))
    .filter(({ r, j }) => rotationRound(rotations, j) < round && !r.failed && endings.has(j))
    .map(({ r, j }) => `${nm(r.a)} and ${nm(r.b)}: ${LOOKED[endings.get(j)!]}`);
  if (earlier.length) parts.push(`Earlier tonight, from across the room — ${earlier.join("; ")}.`);
  const beats = backgroundBeats(nightId, rotations, i, names, seatIds);
  if (beats.length) parts.push(`Around you this round: ${beats.map((b) => b.text).join(" ")}`);
  parts.push("The others can come up in a glance or a line; this date is yours two.");
  return parts.join(" ");
}

/** The room's opening beat on the night page: who takes a seat, and the bell. */
export function roomOpening(nightId: string, venue: string, names: readonly string[]): string {
  const firsts = names.map((n) => shortName(n));
  const list = firsts.length > 1 ? `${firsts.slice(0, -1).join(", ")} and ${firsts[firsts.length - 1]}` : firsts.join("");
  const place = venuePhrase(venue);
  const opens = [
    `${place.charAt(0).toUpperCase()}${place.slice(1)} fills up for the mixer: ${list} take their seats.`,
    `The mixer starts at ${place}. ${list} find their seats and size each other up.`,
    `Drinks, name tags, nerves: ${list} settle in at ${place}.`,
  ];
  return `${opens[deal(`${nightId}:open`, opens.length)]} The bell sits on the bar: six lines with each match, then it rings.`;
}

/**
 * The room's closing beat (who leaves with whom), from each table's ending. Only once every table has aired: the page
 * never shows it earlier, because it would spoil the endings viewers predict.
 */
export function roomClosing(venue: string, tables: readonly { a: string; b: string; ending: Ending }[], names: ReadonlyMap<string, string>, seatIds: readonly string[]): string {
  const nm = (id: string) => shortName(names.get(id) ?? "someone");
  const gone = new Set<string>();
  const lines: string[] = [];
  for (const t of tables.filter((x) => x.ending === "second_date")) {
    if (!gone.has(t.a) && !gone.has(t.b)) {
      lines.push(`${nm(t.a)} and ${nm(t.b)} leave together.`);
      gone.add(t.a).add(t.b);
    } else {
      const free = gone.has(t.a) ? t.b : t.a;
      const taken = free === t.a ? t.b : t.a;
      if (!gone.has(free)) {
        lines.push(`${nm(free)} slips ${nm(taken)} a number on the way out.`);
        gone.add(free);
      }
    }
  }
  for (const t of tables.filter((x) => x.ending === "friends")) {
    if (!gone.has(t.a) && !gone.has(t.b)) {
      lines.push(`${nm(t.a)} and ${nm(t.b)} hug goodbye at the door, friends.`);
      gone.add(t.a).add(t.b);
    }
  }
  const alone = seatIds.filter((id) => !gone.has(id)).map(nm);
  if (alone.length) lines.push(`${alone.length > 1 ? `${alone.slice(0, -1).join(", ")} and ${alone[alone.length - 1]} head` : `${alone[0]} heads`} home on their own.`);
  lines.push(`The bell goes quiet, and ${venuePhrase(venue)} empties out.`);
  return lines.join(" ");
}
