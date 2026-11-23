/**
 * The ship compatibility test's quick reading (app/tools/oc-chemistry-test, two names and nothing else): the playground
 * TRUE LOVE count, shown with its working. Write TRUE LOVE under the two names, count how many times each of its eight
 * letters turns up in them, then add each number to the one beside it, row after row, until two digits are left. A sum
 * of 10 or more becomes its digits added together (13 is 4). Those two digits are the score.
 *
 * A game, and the page says so: names can't know anything about two people or two characters. Pure and deterministic
 * (no model, no randomness, no database), and the same in either order, since it counts the two names together. Only
 * the English alphabet counts; accents come off first (Zoë has an E).
 */

/** The word the letters are counted against, in its order. */
export const TRUE_LOVE = "TRUELOVE";

export type TrueLove = {
  /** Each row of the working, from the eight counts down to the score's two digits. */
  rows: number[][];
  /** 0–99: the last row's two digits. */
  score: number;
};

/** A number of 10 or more as its digits added together, until it's one digit (13 → 4, 19 → 10 → 1). */
export function oneDigit(n: number): number {
  let x = Math.max(0, Math.floor(n));
  while (x >= 10) x = [...String(x)].reduce((sum, d) => sum + Number(d), 0);
  return x;
}

/** The letters a name is counted by: a–z, accents off, lowercase. */
function lettersOf(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
}

/** The TRUE LOVE count for two names, with every row of its working. */
export function trueLove(a: string, b: string): TrueLove {
  const letters = [...lettersOf(`${a}${b}`)];
  let row = [...TRUE_LOVE.toLowerCase()].map((ch) => oneDigit(letters.filter((l) => l === ch).length));
  const rows = [row];
  while (row.length > 2) {
    row = row.slice(1).map((n, i) => oneDigit(row[i] + n));
    rows.push(row);
  }
  return { rows, score: row[0] * 10 + row[1] };
}
