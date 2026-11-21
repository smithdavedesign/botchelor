import { characterTags } from "../character-tags";
import type { Db } from "../db";
import { portraitPathSql } from "../portrait-sql";
import { byDemand, tagById, type TagDef, type TagId } from "../tags";
import { eligibleIds } from "./characters";
import { fold, pairPath, type Whose } from "./pair-pick";
import { coverKey, pairCovers, type CastMember, type CastPair } from "./scenes";

/**
 * After Dark's Characters (app/after-dark/characters; David, 2026-11-20, from joi.com's teardown: "the characters page
 * and gallery would be a nice add to our after dark no?"): everyone this viewer may have a night with, and one page each.
 * Who that is is After Dark's own rule (lib/adult/characters.ts eligibleIds): the house cast, the agent cast it's open
 * to, and the viewer's own characters they've switched In. Nobody else, ever: another person's character is listed only
 * as the agent cast (after_dark_open, never private), and never someone's private one.
 *
 * The grid is filtered and paged here, on the server: the page sends one page of cards, never the whole cast (#1822: the
 * hub once sent every pair, 4.6 MB).
 */

/** Cards a page. */
export const CHARACTERS_PAGE = 36;
/** A card's line of bio, at most (the stylesheet clamps it to two lines; this keeps the page small). */
export const CARD_BIO = 140;
/** Tag chips over the grid, at most: the commonest in this cast first. */
export const TAG_CHIPS = 10;
/** A profile's own pictures and videos of them. */
export const OWN_SHOWN = 8;
/** A profile's showcase posts of them. */
export const SHOWCASE_SHOWN = 8;

export type AdCharacter = {
  id: string;
  name: string;
  bio: string;
  house: boolean;
  /** The viewer's own. */
  mine: boolean;
  hue: number | null;
  /** Their approved PG portrait (the show's own picture, never blurred): lib/portrait-sql.ts. */
  portrait: string | null;
  /** The type tags shown for them (lib/character-tags.ts), at most four. */
  tags: TagId[];
  /** This viewer's nights with them under way (lines, or a chapter filed), with someone still in the cast. */
  nights: number;
};

/** A card: the face this viewer keeps for them, where there is one (adult_face_refs), and how many pictures of them they have. */
export type AdCharacterCard = AdCharacter & { photo: string | null; pictures: number };

export type CharacterFilter = { q: string; whose: Whose; tag: TagId | null; page: number };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

/** The grid's filters from its address (?q=&whose=&tag=&page=): anything unknown reads as no filter, so a typed URL never errors. */
export function parseCharacterFilter(sp: Params): CharacterFilter {
  const q = one(sp.q).trim().slice(0, 64);
  const w = one(sp.whose);
  const whose: Whose = w === "house" || w === "mine" ? w : "all";
  const t = one(sp.tag);
  const tag = t && tagById(t)?.facet === "type" ? (t as TagId) : null;
  const n = Number(one(sp.page));
  return { q, whose, tag, page: Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1 };
}

/** A filter's address, on the grid. `page` 1 is left out. */
export function charactersHref(f: Partial<CharacterFilter>): string {
  const q = new URLSearchParams();
  if (f.q) q.set("q", f.q);
  if (f.whose && f.whose !== "all") q.set("whose", f.whose);
  if (f.tag) q.set("tag", f.tag);
  if (f.page && f.page > 1) q.set("page", String(f.page));
  const s = q.toString();
  return `/after-dark/characters${s ? `?${s}` : ""}`;
}

/** A bio as one short line: whitespace folded, cut at a word near CARD_BIO. */
export function bioLine(bio: string | null | undefined, max = CARD_BIO): string {
  const s = (bio ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

type Row = { id: string; name: string; bio: string | null; house: boolean; mine: boolean; hue: number | null; portrait: string | null };

/**
 * The people behind these ids that this viewer may see: never someone else's private character, whatever put its id
 * in the list (a guard on top of eligibleIds, which never does).
 */
async function peopleOf(db: Db, viewerId: string, ids: readonly string[]): Promise<Row[]> {
  if (!ids.length) return [];
  const { rows } = await db.query<Row>(
    `select c.id, c.name, c.bio, c.is_house as house, c.owner_id is not distinct from $2 as mine, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait
       from characters c
      where c.id = any($1) and (c.visibility <> 'private' or c.owner_id is not distinct from $2 or c.is_house)`,
    [ids, viewerId],
  );
  return rows;
}

const UNDER_WAY = `(jsonb_array_length(lines) > 0 or chapter > 1)`;

/** How many nights this viewer has under way with each of them, counting only nights whose two are both still in. */
async function nightCounts(db: Db, viewerId: string, ids: readonly string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query<{ id: string; n: number }>(
    `select x as id, count(*)::int as n from (
       select character_a as x, character_b as y from adult_scenes where owner_id = $1 and ${UNDER_WAY}
       union all
       select character_b as x, character_a as y from adult_scenes where owner_id = $1 and ${UNDER_WAY}
     ) s where x = any($2) and y = any($2) group by x`,
    [viewerId, ids],
  );
  return new Map(rows.map((r) => [r.id, r.n]));
}

/** Everyone this viewer may have a night with, A to Z: who's in (eligibleIds), with their tags and the viewer's nights. */
export async function adCast(db: Db, viewerId: string): Promise<AdCharacter[]> {
  const ids = [...(await eligibleIds(db, viewerId))];
  const people = await peopleOf(db, viewerId, ids);
  const seen = people.map((p) => p.id);
  const [tags, nights] = await Promise.all([characterTags(db, seen), nightCounts(db, viewerId, seen)]);
  return people
    .map((p) => ({
      id: p.id,
      name: p.name,
      bio: p.bio ?? "",
      house: Boolean(p.house),
      mine: Boolean(p.mine),
      hue: p.hue ?? null,
      portrait: p.portrait,
      tags: tags.get(p.id)?.tags ?? [],
      nights: nights.get(p.id) ?? 0,
    }))
    .sort((x, y) => x.name.localeCompare(y.name));
}

/**
 * The grid's list: those the filters keep, the ones with a night under way first (the most nights first), then A to Z,
 * as the hub's picker orders its faces. A name is found by any part of it, accents aside ("ines" finds Inès).
 */
export function filterCast<T extends AdCharacter>(cast: readonly T[], f: Pick<CharacterFilter, "q" | "whose" | "tag">): T[] {
  const q = fold(f.q.trim());
  return cast
    .filter((c) => (f.whose === "house" ? c.house : f.whose === "mine" ? c.mine : true))
    .filter((c) => !f.tag || c.tags.includes(f.tag))
    .filter((c) => !q || fold(c.name).includes(q))
    .sort((x, y) => y.nights - x.nights || x.name.localeCompare(y.name));
}

/** The type tags this cast has, as chips: the commonest first, then the census's After Dark demand; at most TAG_CHIPS. */
export function tagChips(cast: readonly AdCharacter[]): { tag: TagDef; n: number }[] {
  const counts = new Map<string, number>();
  for (const c of cast) for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const defs = byDemand([...counts.keys()].map((id) => tagById(id)).filter((t): t is TagDef => Boolean(t)), "nsfw");
  return defs
    .map((tag) => ({ tag, n: counts.get(tag.id) ?? 0 }))
    .sort((x, y) => y.n - x.n)
    .slice(0, TAG_CHIPS);
}

/** The face this viewer keeps for each (adult_face_refs, a ready picture), at a card's size: After Dark's own file, blurred while discreet mode is on. */
async function facesOf(db: Db, viewerId: string, ids: readonly string[], w: number): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query<{ character_id: string; image_id: string }>(
    `select f.character_id, f.image_id from adult_face_refs f join adult_images i on i.id = f.image_id and i.status = 'ready'
      where f.owner_id = $1 and f.character_id = any($2)`,
    [viewerId, ids],
  );
  return new Map(rows.map((r) => [r.character_id, `/api/admin/after-dark/media/${encodeURIComponent(r.image_id)}?w=${w}`]));
}

/** How many pictures of each this viewer has (theirs, ready, not one another was kept over). */
async function pictureCounts(db: Db, viewerId: string, ids: readonly string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const ready = `i.owner_id = $1 and i.kind = 'scene' and i.status = 'ready' and i.superseded_by is null`;
  const { rows } = await db.query<{ id: string; n: number }>(
    `select x as id, count(*)::int as n from (
       select i.character_id as x from adult_images i where ${ready} and i.character_id = any($2)
       union all
       select i.character_b as x from adult_images i where ${ready} and i.character_b = any($2)
     ) m group by x`,
    [viewerId, ids],
  );
  return new Map(rows.map((r) => [r.id, r.n]));
}

/**
 * One page's cards: the faces and picture counts for those on it only. `pictures: false` (a place where only the scenes
 * are allowed, lib/jurisdiction.ts): no After Dark faces and no counts of pictures, the PG portraits only.
 */
export async function cardsFor(db: Db, viewerId: string, page: readonly AdCharacter[], opts: { pictures?: boolean } = {}): Promise<AdCharacterCard[]> {
  const ids = page.map((c) => c.id);
  const pictures = opts.pictures !== false;
  const [faces, counts] = pictures ? await Promise.all([facesOf(db, viewerId, ids, 640), pictureCounts(db, viewerId, ids)]) : [new Map<string, string>(), new Map<string, number>()];
  return page.map((c) => ({ ...c, bio: bioLine(c.bio), photo: faces.get(c.id) ?? null, pictures: counts.get(c.id) ?? 0 }));
}

/** One of them, for their page: null when this viewer may not have a night with them (the page is then not found). */
export async function adCharacter(db: Db, viewerId: string, id: string): Promise<AdCharacter | null> {
  if (typeof id !== "string" || !id || id.length > 80) return null;
  const eligible = await eligibleIds(db, viewerId);
  if (!eligible.has(id)) return null;
  const [p] = await peopleOf(db, viewerId, [id]);
  if (!p) return null;
  const [tags, nights] = await Promise.all([characterTags(db, [id]), nightCounts(db, viewerId, [...eligible])]);
  return {
    id: p.id,
    name: p.name,
    bio: p.bio ?? "",
    house: Boolean(p.house),
    mine: Boolean(p.mine),
    hue: p.hue ?? null,
    portrait: p.portrait,
    tags: tags.get(id)?.tags ?? [],
    nights: nights.get(id) ?? 0,
  };
}

type SceneRow = { character_a: string; character_b: string; n: number; chapter: number; updated_at: Date | string | null; last: { who?: string; text?: string } | null };

/**
 * This viewer's nights with them under way, the latest played first, as the hub's Continue cards (CastPair): both faces
 * (the one each keeps for this viewer), the last line, the chapter and, with `covers`, the night's newest picture. Only
 * nights with someone still in the cast, so every card opens.
 */
export async function nightsWith(db: Db, viewerId: string, id: string, opts: { covers?: boolean } = {}): Promise<CastPair[]> {
  const eligible = await eligibleIds(db, viewerId);
  if (!eligible.has(id)) return [];
  const { rows } = await db.query<SceneRow>(
    `select character_a, character_b, jsonb_array_length(lines) as n, chapter, updated_at, lines -> (jsonb_array_length(lines) - 1) as last
       from adult_scenes where owner_id = $1 and (character_a = $2 or character_b = $2) and ${UNDER_WAY}
      order by updated_at desc nulls last`,
    [viewerId, id],
  );
  const scenes = rows.filter((r) => eligible.has(r.character_a) && eligible.has(r.character_b) && r.character_a !== r.character_b);
  if (!scenes.length) return [];
  const ids = [...new Set(scenes.flatMap((r) => [r.character_a, r.character_b]))];
  const [people, faces] = await Promise.all([peopleOf(db, viewerId, ids), facesOf(db, viewerId, ids, 320)]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const who = (x: string): CastMember => {
    const p = byId.get(x);
    return { id: x, name: p?.name ?? x, portrait: p?.portrait ?? null, house: Boolean(p?.house), mine: Boolean(p?.mine), photo: faces.get(x) ?? null };
  };
  const first = (x: string) => (byId.get(x)?.name ?? x).split(/\s+/)[0];
  const nights: CastPair[] = scenes
    .filter((r) => byId.has(r.character_a) && byId.has(r.character_b))
    .map((r) => {
      const said = r.last?.text ? r.last.text.replace(/\*[^*]*\*/g, " ").replace(/\s+/g, " ").trim() : "";
      return {
        a: who(r.character_a),
        b: who(r.character_b),
        lines: r.n ?? 0,
        path: pairPath(r.character_a, r.character_b),
        last: said ? { who: first(r.last!.who === "b" ? r.character_b : r.character_a), text: said.slice(0, 140) } : null,
        chapter: r.chapter ?? 1,
        updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null,
      };
    });
  if (!opts.covers) return nights;
  const covers = await pairCovers(db, viewerId, nights.map((p) => [p.a.id, p.b.id] as const));
  return nights.map((p) => ({ ...p, cover: covers.get(coverKey(p.a.id, p.b.id)) ?? null }));
}
