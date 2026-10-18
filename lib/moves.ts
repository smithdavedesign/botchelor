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
import { movePlace } from "./places";
import { actForTurn, DATE_ACTS, MAX_MOVES, MOVE_SEGMENT_LINES } from "./rules";
import { placeParts, venue, venuePhrase, type PlaceId } from "./venues";

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
  /** Whether a move to one of their homes is allowed now: the final act only (it's hidden until the decision airs). */
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
  return { enabled: opts.moves, segments, total, next, act, place: seg.place, closing, movesLeft, homeOk: act === FINAL_ACT, pending, wrapping };
}

/** What an actor's reply says about moving, before it's settled (lib/conversation.ts parseTurnResult). */
export type MoveReply = { move?: string; accept?: boolean };

/** The place a reply proposes, as this speaker means it ("my place" is theirs), or null. */
const proposed = (reply: MoveReply, names: { self: string; other: string }): PlaceId | null =>
  reply.move ? movePlace(reply.move, names.self, names.other) : null;

const isHome = (place: PlaceId | null): boolean => placeParts(place).id === "home";

/**
 * Why a reply's move fields don't work where the date stands, as a note for a rewrite (the show's critic) or a refusal
 * (an agent's turn); null when they're fine. `they` is the other character's short name.
 */
export function moveProblem(reply: MoveReply, shape: DateShape, names: { self: string; other: string }, they: string): string | null {
  if (!shape.enabled) return null;
  if (shape.pending && reply.accept === undefined) {
    return `${they} suggested taking the date to ${venuePhrase(shape.pending.to)}: answer it in your line, and set "accept_move" to true to go or false to stay`;
  }
  if (!reply.move || (shape.pending && reply.accept === true)) return null;
  if (shape.movesLeft === 0) return 'no more moving tonight: the rest of the date happens here, so leave "move" empty';
  const to = proposed(reply, names);
  if (!to) return 'say where in a few words ("move": a place, like "the night market" or "my place")';
  if (to === shape.place) return `you're already at ${venuePhrase(to)}: leave "move" empty`;
  if (isHome(to) && !shape.homeOk) return "going back to one of your places waits for the end of the night: suggest somewhere out, or stay";
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
  if (shape.pending && reply.accept === true && shape.pending.by !== turn.side) {
    out.moved_to = shape.pending.to;
  } else if (reply.move && shape.movesLeft > 0) {
    const to = proposed(reply, names);
    if (to && to !== shape.place && (shape.homeOk || !isHome(to))) out.move = { say: reply.move.trim().slice(0, 80), to };
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
