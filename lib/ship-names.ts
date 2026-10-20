/**
 * The OC ship name generator (app/tools/ship-name-generator, app/ship/[a]/[b]): two names in, their ship names out.
 *
 * Pure and deterministic: no model, no randomness, no database. The same two names always give the same list, so a
 * /ship/<a>/<b> link shows everyone the same names, and it works with no model key set at all.
 *
 * A ship name is the start of one name and the end of the other ("Junip" + "ex" → Junipex), in both orders, and each
 * side keeps at least two letters so both names are still in it. Blends that read like a name rank first: they join
 * on a shared letter (Draco + Harry → Drarry) or where a consonant meets a vowel, don't pile up consonants or vowels,
 * and keep a fair share of both names at about a name's length.
 *
 * The show's content filter (lib/safety.ts) covers the two names, the pair read together, and every blend: well-known
 * real people and sexual or underage terms never make a ship.
 */
import { checkFields } from "./safety";

/** The longest name the form takes, and the longest ship name shown. */
export const SHIP_NAME_MAX = 24;
/** How many ship names a page shows: up to SHOWN, and past the first MIN_SHOWN only the ones that read well. */
const SHOWN = 10;
const MIN_SHOWN = 5;
/** The fewest letters each name keeps in a blend. */
const KEEP = 2;

/** A name as typed (or read back from an address): how it's shown, its address form, and the word blends use. */
export type ShipName = { display: string; slug: string; core: string };
/** One ship name, and the two pieces it was made from ("Junip" + "ex"). */
export type ShipBlend = { name: string; head: string; tail: string };
export type ShipError = "invalid" | "real_person" | "unsafe";
export type ShipPair = { ok: true; a: ShipName; b: ShipName; names: ShipBlend[] } | { ok: false; error: ShipError };

/** What the result page says instead of ship names. Never repeats the name it refused. */
export const SHIP_ERRORS: Record<ShipError, string> = {
  invalid: `Each name needs 2 to ${SHIP_NAME_MAX} letters. Spaces, hyphens and apostrophes are fine; numbers and symbols aren't.`,
  real_person: "That looks like a real, well-known person. Ship names here are for original characters, so try your OC's name.",
  unsafe: "One of those names has a word the show keeps out. Try another name.",
};

const NAME_CHARS = /^[\p{L}\p{M}' -]+$/u;

const capitalise = (word: string) => {
  const [first = "", ...rest] = [...word];
  return first.toLocaleUpperCase("en") + rest.join("");
};

/**
 * A name from the form or from a /ship address ("mary-jane" reads as "Mary Jane"): letters, spaces, hyphens and
 * apostrophes, at most SHIP_NAME_MAX characters, with a word of at least two letters. Anything else is null.
 * Blends use the first such word, the way ship names are made from first names.
 */
export function readName(raw: string): ShipName | null {
  const text = raw.normalize("NFC").replace(/[‘’]/g, "'").trim();
  if (!text || text.length > SHIP_NAME_MAX || !NAME_CHARS.test(text)) return null;
  const words = text
    .toLocaleLowerCase("en")
    .split(/[ -]+/)
    .filter((w) => /\p{L}/u.test(w));
  const core = words.map((w) => w.replace(/'/g, "")).find((w) => [...w].length >= KEEP);
  if (!core) return null;
  return { display: words.map(capitalise).join(" "), slug: words.join("-"), core };
}

/** A /ship address segment as written in the URL, decoded once (a name never contains "%"). */
export function nameFromSegment(segment: string): string {
  if (!/%[0-9a-f]{2}/i.test(segment)) return segment;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The result page's address for a pair, e.g. /ship/juniper/dex. */
export function shipPath(a: ShipName, b: ShipName): string {
  return `/ship/${encodeURIComponent(a.slug)}/${encodeURIComponent(b.slug)}`;
}

/**
 * Where the form sends two typed names. A name it can't read still goes to the result page, which says why, and
 * an empty segment is "-", which reads as no name.
 */
export function shipHref(rawA: string, rawB: string): string {
  const segment = (raw: string) => {
    const name = readName(raw);
    if (name) return encodeURIComponent(name.slug);
    const loose = raw.trim().toLowerCase().replace(/\s+/g, "-").slice(0, SHIP_NAME_MAX * 2);
    return encodeURIComponent(loose || "-");
  };
  return `/ship/${segment(rawA)}/${segment(rawB)}`;
}

/** Two names in, the ship names out, or the reason there are none. */
export function shipPair(rawA: string, rawB: string): ShipPair {
  const a = readName(rawA);
  const b = readName(rawB);
  // The filter reads what was typed, so "p0rn" is refused for what it says rather than for its digit, and the two
  // names together: "Taylor" and "Swift" are fine apart.
  const check = checkFields({ a: rawA, b: rawB, ...(a && b ? { pair: `${a.display} ${b.display}` } : {}) });
  if (!check.ok) return { ok: false, error: check.reason === "real_person" ? "real_person" : "unsafe" };
  if (!a || !b) return { ok: false, error: "invalid" };
  return { ok: true, a, b, names: blends(a.core, b.core) };
}

/** The ship names for two names, best first (empty when the pair is refused). */
export function shipNames(rawA: string, rawB: string): ShipBlend[] {
  const pair = shipPair(rawA, rawB);
  return pair.ok ? pair.names : [];
}

/* ------------------------------------------------------------------------------------------------------------
 * Blending and ranking.
 * ---------------------------------------------------------------------------------------------------------- */

/** A letter without its accent (ë is e). */
const base = (c: string | undefined) => c?.normalize("NFD")[0];

/** A vowel by its base letter. Y counts as one after the first letter (Harry, Roxy). */
function isVowel(letters: readonly string[], at: number): boolean {
  const c = base(letters[at]);
  if (c === undefined) return false;
  return /[aeiou]/.test(c) || (c === "y" && at > 0);
}

/** How many runs of three or more consonants, or of three or more vowels, a name has. */
function pileUps(letters: readonly string[]): number {
  let count = 0;
  let run = 0;
  for (let k = 0; k < letters.length; k++) {
    run = k > 0 && isVowel(letters, k) === isVowel(letters, k - 1) ? run + 1 : 1;
    if (run === 3) count++;
  }
  return count;
}

/** How well `first[0, i) + second[j…]` reads as a name. Higher is better. */
function rate(first: readonly string[], second: readonly string[], i: number, j: number): number {
  const name = [...first.slice(0, i), ...second.slice(j)];
  const tailLength = second.length - j;
  let score = 0;
  // A shared letter at the seam: the head stops just before the letter the tail starts with (Junip|e·x), or the
  // tail picks up right after the letter the head ends on (Ha|r·r|aco). The two names melt into each other.
  if (first[i] === second[j] || second[j - 1] === first[i - 1]) score += 3;
  // The seam: a consonant meeting a vowel (or a vowel a consonant) reads as one word; two vowels stumble.
  const before = isVowel(name, i - 1);
  const after = isVowel(name, i);
  if (before !== after) score += 2;
  else if (before) score -= 1;
  // The same letter twice at the seam reads like a typo.
  if (base(name[i - 1]) === base(name[i])) score -= 2;
  // Natural cuts: the head stops before one of its own vowels (Br|ad), the tail starts on a vowel or at the top.
  if (i < first.length && isVowel(first, i)) score += 1;
  if (j === 0 || isVowel(second, j)) score += 1;
  // Hard to say: a run of three consonants or vowels, or no vowel but a y (Drry).
  score -= 3 * pileUps(name);
  if (!name.some((c) => /[aeiou]/.test(base(c) ?? ""))) score -= 4;
  // About a name's length, with a fair share of both names.
  const target = Math.min(9, Math.max(4, Math.round((first.length + second.length) * 0.6)));
  score -= Math.abs(name.length - target) * 0.5;
  score += 3 * Math.min(i / first.length, tailLength / second.length);
  // Both whole names glued together is the last resort.
  if (i === first.length && j === 0) score -= 2;
  return score;
}

/** Whether two names are one letter apart (Haraco, Harraco): only the better one makes the first cut. */
function nearlySame(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const rest = (x: string, skip: number) => x.slice(i + skip);
  return rest(a, 1) === rest(b, 1) || rest(a, 1) === rest(b, 0) || rest(a, 0) === rest(b, 1);
}

function blends(x: string, y: string): ShipBlend[] {
  const best = new Map<string, { blend: ShipBlend; score: number }>();
  for (const [first, second] of [
    [[...x], [...y]],
    [[...y], [...x]],
  ]) {
    for (let i = KEEP; i <= first.length; i++) {
      for (let j = 0; j <= second.length - KEEP; j++) {
        const head = first.slice(0, i).join("");
        const tail = second.slice(j).join("");
        const name = head + tail;
        if (name === x || name === y || [...name].length > SHIP_NAME_MAX) continue;
        const score = rate(first, second, i, j);
        const seen = best.get(name);
        if (!seen || score > seen.score) best.set(name, { blend: { name: capitalise(name), head: capitalise(head), tail }, score });
      }
    }
  }
  const ranked = [...best.entries()]
    .sort(([na, a], [nb, b]) => b.score - a.score || (na < nb ? -1 : na > nb ? 1 : 0))
    .map(([, rated]) => rated)
    .filter((r) => checkFields({ name: r.blend.name }).ok);
  // Best first, but a near-copy of a name already shown waits until the rest have had a turn.
  const first: typeof ranked = [];
  const later: typeof ranked = [];
  for (const r of ranked) (first.some((s) => nearlySame(s.blend.name, r.blend.name)) ? later : first).push(r);
  return [...first, ...later]
    .filter((r, k) => k < MIN_SHOWN || r.score > 0)
    .slice(0, SHOWN)
    .map((r) => r.blend);
}
