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

/**
 * The chemistry meter (2026-11-28, Dave's "do 1-6"): how warm the table is after the newest of `turns`, 0..1, from each
 * side's last stated interest (the mean of the two once both have spoken, the one before that). 0.5 before anyone has.
 * `cracked` once someone walked out: the heart breaks and stays broken.
 */
export function chemistryOf(turns: readonly BeatTurn[]): { heat: number; cracked: boolean } {
  let a: number | null = null;
  let b: number | null = null;
  let cracked = false;
  for (const t of turns) {
    if (t.side === "a") a = t.interest;
    else b = t.interest;
    if (t.walked_out) cracked = true;
  }
  const known = [a, b].filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const heat = known.length ? known.reduce((s, x) => s + x, 0) / known.length : 0.5;
  return { heat: Math.max(0, Math.min(1, heat)), cracked };
}

/** A word for the meter's reading, for the screen reader and the hover: "Sparks flying" down to "Ice cold". */
export function chemistryWord(heat: number, cracked = false): string {
  if (cracked) return "Heartbreak";
  if (heat >= 0.8) return "Sparks flying";
  if (heat >= 0.62) return "Warming up";
  if (heat >= 0.42) return "Lukewarm";
  if (heat >= 0.25) return "Cooling off";
  return "Ice cold";
}

/** Which side walks off at a disaster's end: whoever walked out, else the one whose interest ended lower (b on a tie). */
export function leaverOf(turns: readonly BeatTurn[]): "a" | "b" {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].walked_out) return turns[i].side;
  let a = 1;
  let b = 1;
  for (const t of turns) {
    if (t.side === "a") a = t.interest;
    else b = t.interest;
  }
  return a < b ? "a" : "b";
}
