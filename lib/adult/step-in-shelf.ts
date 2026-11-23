/**
 * Step in's shelf of roleplays (app/after-dark/step-in/StepInShelf.tsx). David, 2026-11-23: "Chub.ai does a good job
 * setting up dedicated scenes, might be worth exploring having dedicated after dark characters for a scene?"
 *
 * What the field does (docs/audits/2026-11-23-scenes-and-side-pictures.md): on Chub the unit is a card that is a
 * situation with somebody in it and a first line, but the cards that trend are a reusable character with several
 * openings, not a character made for one scene; Character.AI's Scenes say the same out loud ("Any Character": the
 * scene is written once and the user picks who plays it). After Dark already had the scenes: 45 roleplays, each with
 * a written story card and three openings (lib/adult/roleplays.ts), behind a dropdown in step 3 of the set-up form.
 *
 * So no character is made for a scene. The shelf shows each roleplay as a card cast with someone from the viewer's
 * own After Dark, who brings what a made-for-it character couldn't: their voice, their looks, what they remember.
 * One click starts it (lib/adult/step-in.ts quickStepIn with the roleplay). Pure and client-safe: who a card is cast
 * with is worked out from the day, so the server's page and the browser's agree, and the shelf changes overnight.
 */
import type { StepInCharacter } from "./step-in-shared";

/** How many cards the shelf opens on ("Tonight's"), before a kind is picked or all of them asked for. */
export const SHELF_TONIGHT = 8;

/** A small stable hash of a string (FNV-1a): the same seed always gives the same number. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type ShelfCast = {
  /** Everyone a card can be cast with, in the order "Someone else" walks: each once. */
  order: StepInCharacter[];
  /** How many at the front of `order` the cards open on. */
  leads: number;
  /** The page was opened for one person (?with=<id>): every card is theirs, a cover's own character included. */
  asked: boolean;
};

/**
 * Who the cards are cast with. The people the viewer has already stepped in with come first (the latest first), then
 * the house cast, then everyone else in their After Dark. The cards open on the first group that has anyone in it:
 * someone they chose before, when there is one, is a better guess at who they want than anyone we could pick.
 *
 * `with_`: the page was opened for one of them ("Roleplay or place" on a character's card: ?with=<id>). Then every
 * card opens on that person, and "Someone else" still walks through the rest.
 */
export function shelfCast(cast: readonly StepInCharacter[], recent: readonly string[], with_: string | null = null): ShelfCast {
  const byId = new Map(cast.map((c) => [c.id, c]));
  const order: StepInCharacter[] = [];
  const seen = new Set<string>();
  const take = (c: StepInCharacter | undefined) => {
    if (!c || seen.has(c.id)) return;
    seen.add(c.id);
    order.push(c);
  };
  const asked = with_ ? byId.get(with_) : undefined;
  take(asked);
  for (const id of recent) take(byId.get(id));
  const known = order.length;
  for (const c of cast) if (c.house) take(c);
  const house = order.length - known;
  for (const c of cast) take(c);
  return { order, leads: asked ? 1 : known || house || order.length, asked: Boolean(asked) };
}

/**
 * Who one card is cast with: the same person all day (so a card reads the same on a reload and on the phone), a
 * different spread tomorrow. `turn` steps on through everyone else, one at a time ("Someone else").
 *
 * `poster`: the character in the card's cover picture (lib/adult/roleplay-covers.ts), when it has one and they're in
 * the viewer's After Dark. The card opens on them, whoever the viewer has stepped in with before: the picture is the
 * card, and it shows that person. "Someone else" then walks everyone else from the top of the order, the people the
 * viewer knows first. Not on a page opened for one person, where every card is theirs.
 */
export function shelfLead(roleplayId: string, day: string, cast: ShelfCast, turn = 0, poster: string | null = null): StepInCharacter | null {
  if (!cast.order.length) return null;
  const face = poster && !cast.asked ? (cast.order.find((c) => c.id === poster) ?? null) : null;
  if (face) {
    if (turn === 0) return face;
    const rest = cast.order.filter((c) => c.id !== face.id);
    return rest.length ? rest[(turn - 1) % rest.length] : face;
  }
  const first = hash(`${roleplayId}:${day}`) % Math.max(1, cast.leads);
  return cast.order[(first + turn) % cast.order.length];
}

/**
 * Tonight's cards: `n` of them, a different set each day, in an order that holds for the day. `first`: the ones that
 * have a cover picture: three quarters of tonight's are taken from them (as many as there are, up to that) and shown
 * first, the rest from the others. Six of eight, so the shelf opens on pictures and its rows are of a kind whether
 * it's laid out three across or two (six is three rows of two and two rows of three; four was a mixed second row).
 */
export function shelfTonight<R extends { id: string }>(roleplays: readonly R[], day: string, n = SHELF_TONIGHT, first: ReadonlySet<string> = new Set()): R[] {
  const byDay = (list: readonly R[]) => list.map((r) => ({ r, k: hash(`${day}:${r.id}`) })).sort((x, y) => x.k - y.k || x.r.id.localeCompare(y.r.id)).map((x) => x.r);
  const pictured = byDay(roleplays.filter((r) => first.has(r.id))).slice(0, Math.floor((n * 3) / 4));
  const others = byDay(roleplays.filter((r) => !pictured.includes(r))).slice(0, n - pictured.length);
  return [...pictured, ...others];
}
