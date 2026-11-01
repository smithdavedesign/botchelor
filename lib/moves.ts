/**
 * Moves: two characters on a date agree to take it somewhere else (David, 2026-10-18: "if Chud says come back to my
 * place and Nell says ok, we should change the scene and move the date into another phase… as long as it's mutual
 * agreement"). One proposes on their line ("move"), the other says yes on the very next line ("accept_move"), and the
 * date goes there: the scene changes, and the talk gets a fresh budget in the new place ("reset the convo limits so they
 * can continue the discussion there"), up to MAX_MOVES a date. The engine still decides how the date ends (predictions
 * stay fair): a move changes where it plays out, never how.
 *
 * Everything is read off the transcript. A proposal is stamped on its line with the place it resolved to (once, so a
 * later change to the resolver can't move an old date), and the yes stamps where they went. The show's loop, an agent's
 * steps and every rebuild agree on where a date is, and a date with no moves maps its acts exactly as before.
 */
import type { Turn } from "./conversation";
import { movePlace, placeFor } from "./places";
import { agrees, saysNo } from "./plans";
import { actForTurn, DATE_ACTS, MAX_MOVES, MOVE_SEGMENT_LINES } from "./rules";
import { PLACE_LABEL_MAX, placeParts, venue, venuePhrase, type PlaceId } from "./venues";

const FINAL_ACT = DATE_ACTS.length - 1;

/** A stretch of the date in one place: from line `start`, `budget` lines long (the last one runs to the date's end). */
export type Segment = { start: number; place: PlaceId; budget: number };

export type DateShape = {
  /** Whether this date can move at all (off for a speed date, a template room, a backfill, a date from before moves). */
  enabled: boolean;
  segments: Segment[];
  /** How many lines the date runs to now: each move adds a segment. */
  total: number;
  /** The next line's index, act and place. Acts never go back (the watch room plays lines by act). */
  next: number;
  act: number;
  place: PlaceId;
  /** The goodbye stretch: the final act's last third of the current segment (or the wrap-up past the deadline). */
  closing: boolean;
  /** How many more moves the next line may propose (0 on a segment's last line, past the cutoff or after MAX_MOVES). */
  movesLeft: number;
  /** Whether a move to one of their homes is allowed now: once they're past first impressions (act one keeps the premise). */
  homeOk: boolean;
  /** A proposal the next line answers: the other side's, on the line just before. */
  pending: { say: string; to: PlaceId; by: "a" | "b" } | null;
  /** Past the deadline: the date ends at `total` with a goodbye. */
  wrapping: boolean;
};

export type ShapeOptions = {
  /** Moves allowed on this date. */
  moves: boolean;
  /** Past the move cutoff: a pending proposal can still be answered, but no new one is made. */
  noNewMoves?: boolean;
  /** Past the deadline: the date ends by this line, with a goodbye. */
  endBy?: number;
};

/** The lines a move gives them in the new place: a fresh budget, at most the date's own length. */
export const segmentBudget = (base: number): number => Math.min(base, MOVE_SEGMENT_LINES);

/**
 * What saying yes to a pending move costs, in numbers (#1002, the 2026-10-30 prod loop: "accepting a venue move silently
 * extends the date from 12 to 23 to 31 turns"): the lines in the new place, the new total, and the moves left after it.
 * The new place's lines start after the yes (dateShape), so the new total is the yes's line plus that budget (#1187: a
 * yes on line 11 of 12 goes to 23, not 24).
 */
export function moveCost(shape: DateShape): string {
  const there = segmentBudget(shape.segments[0]?.budget ?? MOVE_SEGMENT_LINES);
  const total = shape.next + 1 + there;
  const left = Math.max(0, MAX_MOVES - shape.segments.length);
  const after = left ? `${left} more move${left === 1 ? "" : "s"} possible after it` : "no more moves after it";
  return `Yes gives ${there} lines there (the date goes from ${shape.total} to ${total}; ${after}); false keeps it at ${shape.total}.`;
}

/** Where the date stands before its next line, from the transcript so far. */
export function dateShape(transcript: readonly Turn[], start: PlaceId, base: number, opts: ShapeOptions = { moves: false }): DateShape {
  const segments: Segment[] = [{ start: 0, place: start, budget: base }];
  if (opts.moves) transcript.forEach((t, i) => t.moved_to && segments.push({ start: i + 1, place: t.moved_to, budget: segmentBudget(base) }));
  const seg = segments[segments.length - 1];
  const next = transcript.length;
  const wrapping = opts.endBy !== undefined;
  const total = wrapping ? Math.max(next, Math.min(seg.start + seg.budget, opts.endBy!)) : seg.start + seg.budget;
  const prevAct = next ? transcript[next - 1].act : 0;
  const act = wrapping ? FINAL_ACT : Math.max(prevAct, actForTurn(next, total));
  const closing = act === FINAL_ACT && (wrapping || next >= total - Math.ceil(seg.budget / 3));
  const last = next ? transcript[next - 1] : null;
  const pending = opts.moves && !wrapping && last?.move && !last.moved_to ? { ...last.move, by: last.side } : null;
  const movesLeft = opts.moves && !wrapping && !opts.noNewMoves && next < total - 1 ? Math.max(0, MAX_MOVES - (segments.length - 1)) : 0;
  return { enabled: opts.moves, segments, total, next, act, place: seg.place, closing, movesLeft, homeOk: act >= 1, pending, wrapping };
}

/** What an actor's reply says about moving, before it's settled (lib/conversation.ts parseTurnResult). */
export type MoveReply = { move?: string; accept?: boolean };

/** The place a reply proposes, as this speaker means it ("my place" is theirs), or null. */
const proposed = (reply: MoveReply, names: { self: string; other: string }): PlaceId | null =>
  reply.move ? movePlace(reply.move, names.self, names.other) : null;

const isHome = (place: PlaceId | null): boolean => placeParts(place).id === "home";

/** Words that go home: a move to one of their places has to say one ("come back to mine?"). */
const HOME_CUE = /\b(mine|yours|my (?:place|flat|apartment|house|home|kitchen|balcony|sofa)|your (?:place|flat|apartment|house|home|kitchen|balcony)|come (?:over|round|back|up)|back to|nightcap|home)\b/i;
const FILLER = new Set(["the", "a", "an", "to", "at", "my", "your", "our", "some", "that", "this", "of", "in", "on", "by", "for"]);

/**
 * Whether a line actually suggests going where its "move" says. A model can fill every field (a 2026-10-18 local run
 * proposed "rainy alley" on a line about hot chocolate), and a proposal nobody spoke would move a date nobody chose:
 * the line has to say the place's own word ("market" for "the night market"), name the same venue in its own words
 * ("karaoke?" for the karaoke booth), or, for one of their homes, say going home.
 */
export function voiced(dialogue: string, say: string, to: PlaceId, names: { self: string; other: string }): boolean {
  if (isHome(to)) return HOME_CUE.test(dialogue);
  if (placeFor(dialogue, names.self, names.other) === to) return true;
  const words = (say.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter((w) => !FILLER.has(w));
  const head = words[words.length - 1];
  return Boolean(head) && new RegExp(`(^|[^\\p{L}])${head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "iu").test(dialogue);
}

/**
 * Whether a line says yes to the pending move: agreeing words, or naming the place ("The night market? Perfect."). A
 * 2026-10-18 local run set "accept_move": true on "Do ghosts whisper, Rafe?", which moved a date nobody agreed to out loud.
 */
const saidYes = (dialogue: string, pending: NonNullable<DateShape["pending"]>, names: { self: string; other: string }): boolean =>
  !saysNo(dialogue) && (agrees(dialogue) || voiced(dialogue, pending.say, pending.to, { self: names.other, other: names.self }));

/**
 * Why a reply's move fields don't work where the date stands, as a note for a rewrite (the show's critic) or a refusal
 * (an agent's turn); null when they're fine. `they` is the other character's short name.
 */
export function moveProblem(
  reply: MoveReply,
  shape: DateShape,
  names: { self: string; other: string },
  they: string,
  dialogue: string,
  /** An agent's turn: a "move" its line never says is refused, so it learns; the show's model just has it dropped. */
  agent = false,
): string | null {
  if (!shape.enabled) return null;
  if (shape.pending && reply.accept === undefined) {
    return `${they} suggested taking the date to ${venuePhrase(shape.pending.to)}: answer it in your line, and set "accept_move" to true to go or false to stay. ${moveCost(shape)}`;
  }
  if (shape.pending && reply.accept === true && saysNo(dialogue)) return 'your line says no but "accept_move" is true: make them agree';
  if (shape.pending && reply.accept === true && !saidYes(dialogue, shape.pending, names)) {
    return `your line doesn't say yes to ${venuePhrase(shape.pending.to)}: say it, or set "accept_move" to false`;
  }
  if (!reply.move || (shape.pending && reply.accept === true)) return null;
  if (shape.movesLeft === 0) return agent ? 'no more moving tonight: the rest of the date happens here, so leave "move" empty' : null;
  const to = proposed(reply, names);
  if (!to) return `say where in a few words, ${PLACE_LABEL_MAX} characters at most ("move": a place, like "the night market" or "my place")`;
  if (to === shape.place) return agent ? `you're already at ${venuePhrase(to)}: leave "move" empty` : null;
  if (!voiced(dialogue, reply.move, to, names)) return agent ? `your line doesn't suggest going to ${venuePhrase(to)}: say it in the line, or leave "move" empty` : null;
  if (isHome(to) && !shape.homeOk) return "it's too early to go back to one of your places: get to know each other here first, then suggest it, or go somewhere out";
  return null;
}

/**
 * Stamps a line with what it does to where the date is: a yes to the pending proposal moves them there (`moved_to`), and
 * a new proposal is resolved to a place once (`move`). Whatever the shape doesn't allow is dropped, and `done` never
 * counts on a line that proposes or moves (the date goes on).
 */
export function settleLine(turn: Turn, reply: MoveReply, shape: DateShape, names: { self: string; other: string }): Turn {
  const out: Turn = { ...turn };
  delete out.move;
  delete out.moved_to;
  if (!shape.enabled) return out;
  if (shape.pending && reply.accept === true && shape.pending.by !== turn.side && saidYes(turn.dialogue, shape.pending, names)) {
    out.moved_to = shape.pending.to;
  } else if (reply.move && shape.movesLeft > 0) {
    const to = proposed(reply, names);
    if (to && to !== shape.place && (shape.homeOk || !isHome(to)) && voiced(turn.dialogue, reply.move, to, names)) out.move = { say: reply.move.trim().slice(0, 80), to };
  }
  if (out.move || out.moved_to) delete out.done;
  return out;
}

/** Every place a date was at, in order: where it started, then each move. */
export function placesOf(transcript: readonly Turn[], start: PlaceId): PlaceId[] {
  return [start, ...transcript.flatMap((t) => (t.moved_to ? [t.moved_to] : []))];
}

/** The places, as a phrase for a prompt: "a rooftop bar at golden hour, then Chud's place". */
export const placesPhrase = (transcript: readonly Turn[], start: PlaceId): string => placesOf(transcript, start).map(venuePhrase).join(", then ");

/** Where a finished date happened, for the morning after and the reflections: the start's stage direction, then any moves. */
export function whereItHappened(transcript: readonly Turn[], start: PlaceId): string {
  const moved = placesOf(transcript, start).slice(1);
  return moved.length ? `${venue(start).prompt}; then they went to ${moved.map(venuePhrase).join(", then ")}` : venue(start).prompt;
}
