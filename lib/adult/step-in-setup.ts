/**
 * What Step in's set-up shows to pick from (app/after-dark/step-in/StepInSetup.tsx; David, 2026-11-24: "The character
 * select should be more full screen so you can see the characters. the role play is a long scroll in the dropdown it's
 * a bad ux"). Until then "who" was a 22rem scroll box of 56 px faces, the roleplay a menu of 46 titles and the place a
 * menu with a full-width picture under it. Now each is picked from pictures: a few on the page, and all of them in a
 * sheet that takes the screen (PickSheet.tsx). This is the choosing of what goes where; the page draws it. Pure and
 * client-safe.
 */
import type { PronounKind } from "./craft";
import { fold } from "./pair-pick";
import type { Roleplay } from "./roleplays";

/** The faces the page itself shows before anyone opens the sheet: two rows of eight on a wide screen (a phone shows the first nine, three rows of three). */
export const INLINE_FACES = 16;

/**
 * The picker's groups cut to what fits on the page: the groups in their order (the people from their scenes, then the
 * house cast, then everyone else) until `max` faces are shown; a group that doesn't fit whole is cut, and the ones after
 * it are left to the sheet. `more`: how many faces the sheet has that the page doesn't.
 */
export function inlineFaces<T>(groups: readonly { label: string; faces: readonly T[] }[], max: number = INLINE_FACES): { groups: { label: string; faces: T[] }[]; shown: number; more: number } {
  const out: { label: string; faces: T[] }[] = [];
  let left = max;
  for (const g of groups) {
    if (left <= 0) break;
    const faces = g.faces.slice(0, left);
    if (faces.length) out.push({ label: g.label, faces });
    left -= faces.length;
  }
  const shown = max - left;
  return { groups: out, shown, more: groups.reduce((n, g) => n + g.faces.length, 0) - shown };
}

/** Who to narrow the cast to (David, 2026-11-24: "add a filter for the character search field, like men, women"): "" for everyone. */
export type WhoKind = "" | PronounKind;
const WHO_KINDS: readonly PronounKind[] = ["she", "he", "they"];
const WHO_KIND_LABEL: Record<PronounKind, string> = { she: "Women", he: "Men", they: "Non-binary" };
/** The kind as the end of "See all 12 …". */
export const WHO_KIND_NOUN: Record<PronounKind, string> = { she: "women", he: "men", they: "non-binary characters" };

/**
 * The kinds the cast can be narrowed to, by the pronouns their sheets give (lib/adult/craft.ts pronounKind): Everyone,
 * then Women, Men and Non-binary as far as anyone is one, each with how many. None at all when fewer than two kinds have
 * anyone (a chip that narrows nothing is noise). Someone whose sheet gives no pronouns shows only under Everyone.
 */
export function whoKinds(cast: readonly { kind?: PronounKind | null }[]): { id: WhoKind; label: string; count: number }[] {
  const n: Record<PronounKind, number> = { she: 0, he: 0, they: 0 };
  for (const c of cast) if (c.kind) n[c.kind]++;
  const present = WHO_KINDS.filter((k) => n[k] > 0);
  if (present.length < 2) return [];
  return [{ id: "", label: "Everyone", count: cast.length }, ...present.map((k) => ({ id: k, label: WHO_KIND_LABEL[k], count: n[k] }))];
}

/** The cast narrowed to one kind ("" keeps everyone). */
export const ofWhoKind = <T extends { kind?: PronounKind | null }>(cast: readonly T[], kind: WhoKind): readonly T[] => (kind ? cast.filter((c) => c.kind === kind) : cast);

/** The kind that shows only the viewer's own roleplays. */
export const STORY_KIND_OWN = "yours";

/**
 * The roleplays the story sheet shows: the viewer's own first, then the show's in the order their kinds are listed
 * (lib/adult/tags.ts roleplayGroups: the most wanted kind first), each once. `kind`: "" for all of them,
 * STORY_KIND_OWN for theirs, or one kind's id. `query` narrows by what a card says: its title, its premise and its
 * two roles.
 */
export function storyChoices(own: readonly Roleplay[], kinds: readonly { id: string; roleplays: readonly Roleplay[] }[], kind: string, query: string): Roleplay[] {
  const seen = new Set<string>();
  const once = (list: readonly Roleplay[]) => list.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  const pool = kind === STORY_KIND_OWN ? once(own) : kind ? once(kinds.find((k) => k.id === kind)?.roleplays ?? []) : [...once(own), ...once(kinds.flatMap((k) => k.roleplays))];
  const q = fold(query.trim());
  if (!q) return pool;
  return pool.filter((r) => fold(`${r.title} ${r.premise} ${r.roles ? r.roles.join(" ") : ""}`).includes(q));
}

/** The two kinds the place sheet narrows by: a scene somewhere public goes as far as a kiss. */
export const PLACE_KINDS = ["private", "public"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/**
 * The places the place sheet shows, in the order a person picks from them: the character's own place first (it's where
 * a scene starts unless they choose), then the places that have a picture, then the ones nobody has drawn yet, each
 * run in the catalog's own order. (The catalog opens on its scenario places, "Stuck in an elevator" and the like, a
 * third of them with no picture: as a menu that didn't matter, and as the first row of a sheet of pictures it was the
 * first thing the first live check showed.) `kind` narrows to somewhere private or somewhere public; `query` to the
 * names that hold what was typed.
 */
export function placeChoices<T extends { id?: string; title: string; image?: string | null; public?: boolean }>(places: readonly T[], query: string, kind: PlaceKind | "" = ""): T[] {
  const q = fold(query.trim());
  const rank = (p: T) => (p.id === "venue:home" ? 0 : p.image ? 1 : 2);
  return places
    .filter((p) => (!q || fold(p.title).includes(q)) && (!kind || (kind === "public") === Boolean(p.public)))
    .map((p, i) => ({ p, i }))
    .sort((x, y) => rank(x.p) - rank(y.p) || x.i - y.i)
    .map((x) => x.p);
}
