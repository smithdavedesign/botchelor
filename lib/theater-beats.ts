/**
 * The date theater's camera (2026-11-28, Dave: "a camera that moves"): which lines are big enough for the camera to
 * push in on. Client-safe: pure, from the stored turns only.
 */

type BeatTurn = { side: "a" | "b"; interest: number; walked_out?: true; move?: unknown; moved_to?: unknown; done?: boolean };

/** How far a side's interest has to jump, up or down, from their own last line for the camera to notice. */
export const BIG_SWING = 0.2;

/** Whether the newest of `turns` is a big line: a walk-out, a move somewhere else, a yes to one, or a swing in interest. */
export function bigLine(turns: readonly BeatTurn[]): boolean {
  const last = turns[turns.length - 1];
  if (!last) return false;
  if (last.walked_out || last.move || last.moved_to) return true;
  for (let i = turns.length - 2; i >= 0; i--) {
    if (turns[i].side === last.side) return Math.abs(last.interest - turns[i].interest) >= BIG_SWING;
  }
  return false;
}

/** Who has the light: the side of the newest line, or nobody before the first. */
export const speakerOf = (turns: readonly { side: "a" | "b" }[]): "a" | "b" | null => turns[turns.length - 1]?.side ?? null;
