import type { Db } from "../db";
import type { ReelShot } from "./reels";

/**
 * The After Dark library (David, 2026-10-24: "a new page that has all the NSFW clips, images and videos, sortable by
 * characters, user rating, type, model that created it, with pagination"): every picture, portrait, video of a night and
 * clip After Dark has kept, everyone's, read as a moderator like the graph (/admin/after-dark/graph): signed-in admins
 * only. Each can be rated 1–5 stars by whoever's looking; the list sorts by the average.
 *
 * What's an item: a ready picture or portrait (adult_images 'scene' or 'baseline'; a scene with a video's mime is one of
 * fal's old clips), or a video (adult_reels: a night's, or a clip) with at least one shot that came through. A keyframe
 * (adult_images 'frame') is a video's start, not an item; nor is a shot on its own.
 *
 * The model: a picture's as kept since 2026-10-24 (adult_images.model), else only its provider ("venice, model not
 * recorded"); a video's from its shots, which always kept theirs. Nothing is guessed.
 */

export const LIBRARY_TYPES = ["picture", "portrait", "video", "clip"] as const;
export type LibraryType = (typeof LIBRARY_TYPES)[number];
export const LIBRARY_SORTS = ["newest", "oldest", "rating", "characters", "type", "model"] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];
export const LIBRARY_PAGE_SIZE = 24;

export type LibraryQuery = { sort: LibrarySort; type: LibraryType | null; character: string | null; model: string | null; page: number };

export type LibraryItem = {
  id: string;
  /** What `id` names: an adult_images row (a picture or portrait) or an adult_reels row (a video or clip). */
  item: "image" | "reel";
  type: LibraryType;
  created_at: string;
  a: { id: string; name: string };
  b: { id: string; name: string } | null;
  /** The model that made it: a picture's, or a video's shots' (several when they differ); null when not recorded. */
  model: string | null;
  provider: string | null;
  mime: string;
  /** A video's shots that came through, in order. */
  shots: { media_id: string; who: "a" | "b"; text: string }[];
  rating: { average: number | null; count: number; mine: number | null };
};

export type LibraryPage = {
  items: LibraryItem[];
  total: number;
  page: number;
  pages: number;
  /** For the filters: everyone with an item, and every model named. */
  characters: { id: string; name: string }[];
  models: string[];
};

const str = (v: unknown) => (typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : null);

/** The page's query from its search params: anything unknown is the default. */
export function libraryQuery(p: Record<string, string | string[] | undefined>): LibraryQuery {
  const sort = str(p.sort);
  const type = str(p.type);
  const page = Number(str(p.page) ?? 1);
  return {
    sort: (LIBRARY_SORTS as readonly string[]).includes(sort ?? "") ? (sort as LibrarySort) : "newest",
    type: (LIBRARY_TYPES as readonly string[]).includes(type ?? "") ? (type as LibraryType) : null,
    character: str(p.character)?.slice(0, 64) || null,
    model: str(p.model)?.slice(0, 120) || null,
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}

/** The same query as search params (the defaults left out), for a link that changes one thing. */
export function libraryHref(q: LibraryQuery, change: Partial<LibraryQuery> = {}): string {
  const next = { ...q, ...change };
  const sp = new URLSearchParams();
  if (next.sort !== "newest") sp.set("sort", next.sort);
  if (next.type) sp.set("type", next.type);
  if (next.character) sp.set("character", next.character);
  if (next.model) sp.set("model", next.model);
  if (next.page > 1) sp.set("page", String(next.page));
  const s = sp.toString();
  return s ? `?${s}` : "?";
}

/** Every item, as one list (see the module comment). */
const ITEMS = `
  select i.id, 'image' as item,
         case when i.kind = 'baseline' then 'portrait' when i.mime like 'video/%' then 'clip' else 'picture' end as type,
         i.created_at, i.character_id as a, i.character_b as b, i.model, i.provider, i.mime, null::jsonb as shots
    from adult_images i
   where i.status = 'ready' and i.kind in ('scene', 'baseline') and i.character_id is not null
  union all
  select r.id, 'reel' as item, case when r.kind = 'clip' then 'clip' else 'video' end as type,
         r.created_at, r.character_a as a, r.character_b as b,
         (select string_agg(distinct s->>'model', ', ') from jsonb_array_elements(r.shots) s where s->>'status' = 'ready' and s->>'model' is not null) as model,
         r.provider, 'video/mp4' as mime, r.shots
    from adult_reels r
   where exists (select 1 from jsonb_array_elements(r.shots) s where s->>'status' = 'ready' and s->>'media_id' is not null)`;

const ORDER: Record<LibrarySort, string> = {
  newest: "created_at desc, id",
  oldest: "created_at asc, id",
  rating: "average desc nulls last, count desc, created_at desc, id",
  characters: "least(lower(a_name), lower(coalesce(b_name, a_name))), greatest(lower(a_name), lower(coalesce(b_name, a_name))), created_at desc, id",
  type: "type, created_at desc, id",
  model: "model nulls last, provider nulls last, created_at desc, id",
};

type Row = {
  id: string;
  item: "image" | "reel";
  type: LibraryType;
  created_at: string | Date;
  a: string;
  b: string | null;
  a_name: string | null;
  b_name: string | null;
  model: string | null;
  provider: string | null;
  mime: string;
  shots: ReelShot[] | null;
  average: number | null;
  count: number | null;
  mine: number | null;
  total: number;
};

/** One page of the library for this viewer: their own stars on each, everyone's average. */
export async function listLibrary(db: Db, viewer: string, q: LibraryQuery): Promise<LibraryPage> {
  const where: string[] = [];
  const params: unknown[] = [viewer];
  const arg = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (q.type) where.push(`type = ${arg(q.type)}`);
  if (q.character) {
    const c = arg(q.character);
    where.push(`(a = ${c} or b = ${c})`);
  }
  if (q.model) where.push(`model = ${arg(q.model)}`);
  const limit = arg(LIBRARY_PAGE_SIZE);
  const offset = arg((q.page - 1) * LIBRARY_PAGE_SIZE);
  const sql = `
    with items as (${ITEMS}),
    rated as (select item_id, avg(rating)::float8 as average, count(*)::int as count from adult_media_ratings group by item_id),
    named as (
      select items.*, ca.name as a_name, cb.name as b_name, rated.average, rated.count, mine.rating as mine
        from items
        left join characters ca on ca.id = items.a
        left join characters cb on cb.id = items.b
        left join rated on rated.item_id = items.id
        left join adult_media_ratings mine on mine.item_id = items.id and mine.user_id = $1
    )
    select *, count(*) over () as total from named
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by ${ORDER[q.sort]}
    limit ${limit} offset ${offset}`;
  const [rows, people, models] = await Promise.all([
    db.query<Row>(sql, params).then((r) => r.rows),
    db.query<{ id: string; name: string }>(
      `with items as (${ITEMS}) select distinct c.id, c.name from items join characters c on c.id = items.a or c.id = items.b order by c.name`,
    ).then((r) => r.rows),
    db.query<{ model: string }>(`with items as (${ITEMS}) select distinct model from items where model is not null order by model`).then((r) => r.rows.map((m) => m.model)),
  ]);
  const total = rows.length ? Number(rows[0].total) : q.page > 1 ? await countOnly(db, where, params.slice(0, -2)) : 0;
  return {
    items: rows.map((r) => ({
      id: r.id,
      item: r.item,
      type: r.type,
      created_at: new Date(r.created_at).toISOString(),
      a: { id: r.a, name: r.a_name ?? r.a },
      b: r.b ? { id: r.b, name: r.b_name ?? r.b } : null,
      model: r.model,
      provider: r.provider,
      mime: r.mime,
      shots: (r.shots ?? []).filter((s) => s.status === "ready" && s.media_id).map((s) => ({ media_id: s.media_id!, who: s.who, text: s.text })),
      rating: { average: r.average === null ? null : Math.round(Number(r.average) * 10) / 10, count: Number(r.count ?? 0), mine: r.mine === null ? null : Number(r.mine) },
    })),
    total,
    page: q.page,
    pages: Math.max(1, Math.ceil(total / LIBRARY_PAGE_SIZE)),
    characters: people,
    models,
  };
}

/** The count alone, for a page past the end (it has no rows to read the total from). */
async function countOnly(db: Db, where: string[], params: unknown[]): Promise<number> {
  // The filters' placeholders count from $1, the viewer, which the count names only to keep them in place.
  const sql = `with items as (${ITEMS}) select count(*)::int as n from items where $1::text is not null${where.map((w) => ` and ${w}`).join("")}`;
  return Number((await db.query<{ n: number }>(sql, params)).rows[0]?.n ?? 0);
}

/** What a library item says it was made by: its model, or its provider with the model not recorded. */
export function madeBy(item: Pick<LibraryItem, "model" | "provider">): string {
  if (item.model) return item.model;
  return item.provider ? `${item.provider}, model not recorded` : "not recorded";
}

export type RateResult = { ok: true; rating: LibraryItem["rating"] } | { ok: false; status: number; message: string };

/** The viewer's stars on an item (1–5), or null to take theirs back; the item's new average. */
export async function rateItem(db: Db, viewer: string, itemId: string, stars: number | null): Promise<RateResult> {
  const found = (
    await db.query<{ kind: "image" | "reel" }>(
      `select 'image' as kind from adult_images where id = $1 and status = 'ready' and kind in ('scene', 'baseline')
       union all select 'reel' from adult_reels where id = $1 limit 1`,
      [itemId],
    )
  ).rows[0];
  if (!found) return { ok: false, status: 404, message: "That isn't in the library." };
  if (stars === null) await db.query(`delete from adult_media_ratings where user_id = $1 and item_id = $2`, [viewer, itemId]);
  else {
    await db.query(
      `insert into adult_media_ratings (user_id, item_id, item_kind, rating) values ($1, $2, $3, $4)
       on conflict (user_id, item_id) do update set rating = excluded.rating, updated_at = now()`,
      [viewer, itemId, found.kind, stars],
    );
  }
  const agg = (await db.query<{ average: number | null; count: number }>(`select avg(rating)::float8 as average, count(*)::int as count from adult_media_ratings where item_id = $1`, [itemId])).rows[0];
  return {
    ok: true,
    rating: { average: agg?.average === null || agg?.average === undefined ? null : Math.round(Number(agg.average) * 10) / 10, count: Number(agg?.count ?? 0), mine: stars },
  };
}
