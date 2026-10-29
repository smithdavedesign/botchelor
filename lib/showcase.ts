/**
 * The creator showcase (docs/PRDs/showcase.md; David, 2026-10-29: "a content creator page where it showcases work, like
 * Instagram or candy.ai"): work its creators chose to publish, one item at a time, under a creator handle of their own.
 *
 *  - **Nothing is public unless its owner publishes it.** The legal page promises After Dark media is never shown unless
 *    they send it there themselves, so each post is their own act, and unpublishing takes it down at once.
 *  - **Who sees what** (David's call): pg posts are for everyone, suggestive ones for signed-in people (never a bot).
 *    Explicit (nsfw) posts are built but seen by admins only until counsel signs off and age checks are live; then one
 *    switch (`studio.showcase.explicit_open`) opens them to age-verified people After Dark is open to.
 *  - **Pairs** (David's call): a picture with someone else's character needs that owner's OK; until it's given the post
 *    waits (`pending`). The house cast needs only the publisher.
 *  - **Creators** (David's call): an opt-in handle (creator_profiles), never tied to a login name or an email.
 *  - **Filters** read what each item was tagged with as it was made (lib/adult/media-tags.ts tagNow, studio_pg_pictures
 *    .tags), copied onto the post when it's published: character, creator, partner, medium, act (pose or position),
 *    place, first person, from a date or the Studio, shape.
 */
import { isAdmin } from "./admins";
import { adultViewer } from "./adult/mode";
import { mediaAllowedFor } from "./adult/place";
import { getAdultSettings } from "./adult/settings";
import { crossesTaboo } from "./adult/acts";
import { detectBot } from "./bots";
import { ratingOf, type ContentRating } from "./content-rating";
import type { Db } from "./db";
import { authFromRequest } from "./http";
import { checkAdultText, checkPgPictureText } from "./safety";

export const MEDIUMS = ["picture", "clip", "reel", "boomerang", "loop"] as const;
export type Medium = (typeof MEDIUMS)[number];
export const MEDIUM_LABEL: Record<Medium, string> = { picture: "Pictures", clip: "Clips", reel: "Date reels", boomerang: "Boomerangs", loop: "Loops" };
export type ShowcaseSource = "after_dark" | "pg";

export type Fail = { ok: false; status: number; error: string; message: string };
const fail = (status: number, error: string, message: string): Fail => ({ ok: false, status, error, message });

/* -------------------------------------------------- creators -------------------------------------------------- */

export type CreatorProfile = { handle: string; display_name: string; bio: string | null };
const HANDLE = /^[a-z0-9_]{3,24}$/;
const RESERVED = new Set(["admin", "admins", "botchelor", "support", "staff", "official", "moderator", "me", "new", "showcase"]);

export async function creatorProfile(db: Db, userId: string): Promise<CreatorProfile | null> {
  return (await db.query<CreatorProfile>(`select handle, display_name, bio from creator_profiles where user_id = $1`, [userId])).rows[0] ?? null;
}

/** Claims or edits their creator handle, name and bio: public words, so held to the show's own lines. */
export async function saveCreatorProfile(db: Db, userId: string, input: { handle: string; display_name: string; bio?: string | null }): Promise<{ ok: true; profile: CreatorProfile } | Fail> {
  const handle = input.handle.trim().toLowerCase();
  if (!HANDLE.test(handle) || RESERVED.has(handle)) return fail(422, "bad_handle", "A handle is 3 to 24 letters, numbers or underscores (and not a reserved word).");
  const display = input.display_name.trim().slice(0, 40);
  const bio = (input.bio ?? "").trim().slice(0, 300) || null;
  if (!display) return fail(422, "bad_name", "Give your creator page a name.");
  if (!checkPgPictureText({ handle, display, bio: bio ?? "" }).ok) return fail(422, "not_allowed", "That can't be on a public page: keep it to the show's lines.");
  const taken = (await db.query(`select 1 from creator_profiles where handle = $1 and user_id <> $2`, [handle, userId])).rows.length > 0;
  if (taken) return fail(409, "taken", "That handle is taken.");
  await db.query(
    `insert into creator_profiles (user_id, handle, display_name, bio) values ($1, $2, $3, $4)
     on conflict (user_id) do update set handle = excluded.handle, display_name = excluded.display_name, bio = excluded.bio`,
    [userId, handle, display, bio],
  );
  return { ok: true, profile: { handle, display_name: display, bio } };
}

/* -------------------------------------------------- who sees what -------------------------------------------------- */

export type ShowcaseViewer = { id: string | null; admin: boolean; ratings: ContentRating[]; adult?: boolean; bot?: boolean };

/** Whether explicit posts are open beyond admins (David's call: off until counsel and age checks). */
export async function explicitOpen(db: Db): Promise<boolean> {
  return (await getAdultSettings(db)).studio.showcase.explicit_open;
}

/** The ratings this request may see: pg for everyone; suggestive signed in (never a bot); nsfw an admin, or when open. */
export async function showcaseViewer(db: Db, req: Request): Promise<ShowcaseViewer> {
  const auth = authFromRequest(req);
  const id = auth?.authenticated ? auth.userId : null;
  const bot = Boolean(detectBot(req.headers.get("user-agent")));
  const admin = id ? await isAdmin(db, id) : false;
  const ratings: ContentRating[] = ["pg"];
  if (id && !bot) ratings.push("suggestive");
  // After Dark open to them (and media where they are): what lets an asked owner see an explicit post they're asked about.
  const adultId = id && !bot ? await adultViewer(db, req) : null;
  const adult = Boolean(adultId && (admin || (await mediaAllowedFor(db, adultId))));
  if (adult && (admin || (await explicitOpen(db)))) ratings.push("nsfw");
  return { id, admin, ratings, adult, bot };
}

/* -------------------------------------------------- publishing -------------------------------------------------- */

export type Post = {
  id: string; source: ShowcaseSource; media_id: string; mime: string; rating: ContentRating; medium: Medium; aspect: string | null;
  act: string | null; place: string | null; pov: boolean; from_date: boolean; caption: string | null; status: string; published_at: string;
  creator: { handle: string; display_name: string }; character: { id: string; name: string }; partner: { id: string; name: string } | null;
  mine: boolean;
  /** Its menu picks can be shot again ("Shoot like this"): it was made in a Studio shoot. */
  remixable: boolean;
  /** Its likes, and whether this viewer is one of them (lib/showcase-social.ts). */
  likes: number;
  liked: boolean;
};

type SourceRow = {
  id: string; owner_id: string; character_id: string; character_b: string | null; kind: string; mime: string; aspect: string | null; rating: string | null; derived: string | null; reel_kind: string | null; shoot_id: string | null;
  /** Made on one of their dates (the "From dates" filter): never a Studio item, a portrait, an SFW twin, or one cut from a Studio item. */
  from_date: boolean;
};

/** Whether an After Dark item `i` was made on a date (lib/db.ts puts the same rule on the posts kept before it). */
const FROM_DATE = `i.kind <> 'baseline' and i.shoot_id is null and i.twin_of is null
  and not exists (select 1 from adult_images src where src.id = i.source_image and src.shoot_id is not null)`;

/** The item behind a post: one of theirs, ready, a picture or clip (never a voice or a keyframe). */
async function sourceOf(db: Db, owner: string, source: ShowcaseSource, mediaId: string): Promise<SourceRow | null> {
  if (source === "pg") {
    return (
      await db.query<SourceRow>(
        `select id, owner_id, character_id, null as character_b, 'scene' as kind, mime, aspect, content_rating as rating, null as derived, null as reel_kind, shoot_id, false as from_date
           from studio_pg_pictures where id = $1 and owner_id = $2`,
        [mediaId, owner],
      )
    ).rows[0] ?? null;
  }
  return (
    await db.query<SourceRow>(
      `select i.id, i.owner_id, i.character_id, i.character_b, i.kind, i.mime, i.aspect, i.content_rating as rating, i.derived, i.shoot_id,
              (select r.kind from adult_reels r cross join lateral jsonb_array_elements(r.shots) s where r.owner_id = i.owner_id and s->>'media_id' = i.id limit 1) as reel_kind,
              (${FROM_DATE}) as from_date
         from adult_images i
        where i.id = $1 and i.owner_id = $2 and i.status = 'ready' and i.kind in ('scene', 'baseline', 'video') and i.character_id is not null`,
      [mediaId, owner],
    )
  ).rows[0] ?? null;
}

/** What kind of thing it is, for the Medium filter. */
export function mediumOf(r: Pick<SourceRow, "kind" | "derived" | "reel_kind">): Medium {
  if (r.kind !== "video") return "picture";
  if (r.derived === "boomerang" || r.derived === "loop") return r.derived;
  return r.reel_kind && r.reel_kind !== "clip" ? "reel" : "clip";
}

/** The first of each kind of tag it was made with (removed ones left out), for the filters. */
async function tagsFor(db: Db, source: ShowcaseSource, mediaId: string): Promise<{ act: string | null; place: string | null; pov: boolean; tags: { kind: string; value: string }[] }> {
  const tags =
    source === "pg"
      ? ((await db.query<{ tags: { kind: string; value: string }[] }>(`select tags from studio_pg_pictures where id = $1`, [mediaId])).rows[0]?.tags ?? [])
      : (await db.query<{ kind: string; value: string }>(`select kind, value from adult_media_tags where media_id = $1 and not removed and kind <> 'date' order by created_at`, [mediaId])).rows;
  const first = (k: string) => tags.find((t) => t.kind === k)?.value ?? null;
  return { act: first("act"), place: first("place"), pov: tags.some((t) => t.kind === "pov"), tags };
}

/**
 * Publishes one of their items under their creator handle. Their own characters and the house cast publish at once; a
 * picture with someone else's character waits for that owner's OK (`pending`; lib/showcase-consent.ts). A caption is
 * public words: held to the show's lines on a pg post, to After Dark's on any other.
 */
export async function publish(db: Db, owner: string, input: { source: ShowcaseSource; media_id: string; caption?: string | null; show_prompt?: boolean }): Promise<{ ok: true; post_id: string; status: "live" | "pending" } | Fail> {
  if (!(await creatorProfile(db, owner))) return fail(409, "no_profile", "Pick your creator handle first.");
  const src = await sourceOf(db, owner, input.source, input.media_id);
  if (!src) return fail(404, "not_found", "There's nothing of yours with that id.");
  const rating = ratingOf(src.rating);
  const caption = (input.caption ?? "").trim().slice(0, 300) || null;
  if (caption) {
    const ok = rating === "pg" ? checkPgPictureText({ caption }).ok : checkAdultText({ caption }).ok && !crossesTaboo(caption);
    if (!ok) return fail(422, "not_allowed", "That caption crosses a line: try other words.");
  }
  const existing = (await db.query<{ id: string; status: string }>(`select id, status from showcase_posts where source = $1 and media_id = $2`, [input.source, src.id])).rows[0];
  if (existing?.status === "removed") return fail(403, "removed", "That one was taken down by the show's moderators.");
  // Who's in it: whose characters they are decides whether someone else has to say yes.
  const others = (
    await db.query<{ id: string; owner_id: string | null; is_house: boolean }>(`select id, owner_id, is_house from characters where id = any($1::text[])`, [[src.character_id, src.character_b].filter(Boolean)])
  ).rows.filter((c) => !c.is_house && c.owner_id && c.owner_id !== owner);
  const status = others.length ? "pending" : "live";
  const wasLive = existing?.status === "live";
  const t = await tagsFor(db, input.source, src.id);
  const remix = await remixPicks(db, input.source, src.shoot_id);
  const id = existing?.id ?? crypto.randomUUID();
  await db.query(
    `insert into showcase_posts (id, owner_id, source, media_id, character_id, character_b, rating, medium, aspect, act, place, pov, from_date, caption, tags, status, published_at, remix, show_prompt)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, case when $16 = 'live' then now() end, $17::jsonb, $18)
     on conflict (source, media_id) do update set caption = excluded.caption, rating = excluded.rating, show_prompt = excluded.show_prompt, status = case when showcase_posts.status = 'live' then 'live' else excluded.status end,
       published_at = coalesce(showcase_posts.published_at, excluded.published_at)`,
    [id, owner, input.source, src.id, src.character_id, src.character_b, rating, mediumOf(src), src.aspect, t.act, t.place, t.pov, src.from_date === true, caption, JSON.stringify(t.tags), status, remix ? JSON.stringify(remix) : null, input.show_prompt !== false],
  );
  for (const c of others) {
    await db.query(`insert into showcase_consents (post_id, owner_id, character_id) values ($1, $2, $3) on conflict do nothing`, [id, c.owner_id, c.id]);
  }
  // The other owners asked for their OK; or, live now, the creator's followers told (lib/showcase-social.ts).
  const social = await import("./showcase-social");
  if (status === "pending" && !existing) await social.askForOk(db, id);
  if (status === "live" && !wasLive) await social.tellFollowers(db, owner);
  return { ok: true, post_id: id, status };
}

/** Menu keys a remix may carry: what a Studio's own menus picked, never words, a place of their own, or who with. */
const NEVER_REMIXED = new Set(["custom", "extra", "dialog", "reference", "partner", "level", "size", "eyes", "own_place", "source", "seconds", "queue_id", "request", "guide", "transcript"]);

export type RemixPicks = { studio: ShowcaseSource; kind: "shoot" | "pair"; choices: Record<string, unknown>; format: string | null };

/**
 * The menu picks a post was made with, for "Shoot like this" (David's call: menu picks only, never their typed words
 * or their characters): from its Studio shoot (alone or together) or its PG shoot; null for one made on a date.
 */
async function remixPicks(db: Db, source: ShowcaseSource, shootId: string | null): Promise<RemixPicks | null> {
  if (!shootId) return null;
  const row = (
    await db.query<{ kind: string; choices: Record<string, unknown> | null }>(
      source === "pg" ? `select coalesce(kind, 'shoot') as kind, choices from studio_pg_shoots where id = $1` : `select kind, choices from adult_studio_shoots where id = $1`,
      [shootId],
    )
  ).rows[0];
  if (!row || (row.kind !== "shoot" && row.kind !== "pair") || !row.choices) return null;
  const choices: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row.choices)) {
    if (NEVER_REMIXED.has(k) || k === "format") continue;
    // A place of their own (the Studio's own:N) is theirs, not a menu pick.
    if (typeof v === "string" && v.startsWith("own:")) continue;
    if (typeof v === "string" || typeof v === "boolean" || (Array.isArray(v) && v.every((x) => typeof x === "string"))) choices[k] = v;
  }
  const format = typeof row.choices.format === "string" ? row.choices.format : null;
  return { studio: source, kind: row.kind as "shoot" | "pair", choices, format };
}

/** A post's picks to shoot again, for someone who can see it. */
export async function remixOf(db: Db, v: ShowcaseViewer, postId: string): Promise<(RemixPicks & { creator: string }) | null> {
  if (!(await postMedia(db, v, postId))) return null;
  const r = (await db.query<{ remix: RemixPicks | null; handle: string }>(`select p.remix, cp.handle from showcase_posts p join creator_profiles cp on cp.user_id = p.owner_id where p.id = $1`, [postId])).rows[0];
  return r?.remix ? { ...r.remix, creator: r.handle } : null;
}

/**
 * Takes a post down: its creator, or the other owner of a character in it, any time (and an admin, as a moderator:
 * `removed`, and it can't be put back).
 */
export async function unpublish(db: Db, viewer: string, postId: string): Promise<boolean> {
  const admin = await isAdmin(db, viewer);
  const r = await db.query(
    `delete from showcase_posts p where p.id = $1 and (p.owner_id = $2 or exists (select 1 from showcase_consents s where s.post_id = p.id and s.owner_id = $2)) returning p.id`,
    [postId, viewer],
  );
  if (r.rows.length) return true;
  if (!admin) return false;
  return (await db.query(`update showcase_posts set status = 'removed' where id = $1 returning id`, [postId])).rows.length > 0;
}

/** Their posts by item, so a tile can say it's live (or waiting) and offer Unpublish. */
export async function postsOf(db: Db, owner: string, source: ShowcaseSource, mediaIds: readonly string[]): Promise<Record<string, { id: string; status: string }>> {
  if (!mediaIds.length) return {};
  const { rows } = await db.query<{ id: string; media_id: string; status: string }>(`select id, media_id, status from showcase_posts where owner_id = $1 and source = $2 and media_id = any($3::text[])`, [owner, source, mediaIds]);
  return Object.fromEntries(rows.map((r) => [r.media_id, { id: r.id, status: r.status }]));
}

/* -------------------------------------------------- the feed -------------------------------------------------- */

export type Filters = {
  creator?: string; character?: string; partner?: string; medium?: Medium; act?: string; place?: string; pov?: boolean;
  from?: "studio" | "date";
  /** Safe for work (pg and suggestive: the default, for everyone) or After Dark (explicit), by each post's rating. */
  side?: "pg" | "after_dark";
  shape?: string; page?: number;
  /** Only creators this viewer follows; the most liked this week first. */
  following?: boolean; sort?: "new" | "trending";
};
export const PAGE_SIZE = 36;

/** The filters from a URL's query (?creator=&character=&partner=&medium=&act=&place=&pov=1&from=&side=&shape=&page=). */
export function parseFilters(q: URLSearchParams | Record<string, string | string[] | undefined>): Filters {
  const get = (k: string): string | undefined => {
    const v = q instanceof URLSearchParams ? q.get(k) : q[k];
    const one = Array.isArray(v) ? v[0] : v;
    return one && one.length <= 64 ? one : undefined;
  };
  const medium = get("medium");
  const from = get("from");
  const side = get("side");
  const shape = get("shape");
  return {
    creator: get("creator"), character: get("character"), partner: get("partner"),
    medium: (MEDIUMS as readonly string[]).includes(medium ?? "") ? (medium as Medium) : undefined,
    act: get("act"), place: get("place"), pov: get("pov") === "1" || undefined,
    from: from === "studio" || from === "date" ? from : undefined,
    side: side === "pg" || side === "after_dark" ? side : undefined,
    shape: shape && /^\d{1,2}:\d{1,2}$/.test(shape) ? shape : undefined,
    page: Math.max(1, Math.floor(Number(get("page") ?? 1)) || 1),
    following: get("following") === "1" || undefined,
    sort: get("sort") === "trending" ? "trending" : undefined,
  };
}

/** Which side a filter shows: safe for work unless After Dark is asked for. */
export const sideOf = (f: Filters): "pg" | "after_dark" => (f.side === "after_dark" ? "after_dark" : "pg");

/**
 * The filters as SQL against showcase_posts `p` (with the viewer's ratings as $1), and their values. `anySide`: both
 * sides (to count each).
 */
function where(v: ShowcaseViewer, f: Filters, opts: { anySide?: boolean } = {}): { sql: string; args: unknown[] } {
  const args: unknown[] = [v.ratings];
  const parts = ["p.status = 'live'", "not p.held", "p.rating = any($1::text[])", "not cp.hidden"];
  // Each `?` in a part is that part's one value.
  const add = (sql: string, value: unknown) => {
    args.push(value);
    parts.push(sql.replaceAll("?", `$${args.length}`));
  };
  if (f.creator) add("cp.handle = ?", f.creator.toLowerCase());
  if (f.character) add("(p.character_id = ? or p.character_b = ?)", f.character);
  // With someone: a picture of two with them in it (with a character filter too, that pair).
  if (f.partner) add("(p.character_b is not null and (p.character_id = ? or p.character_b = ?))", f.partner);
  if (f.medium) add("p.medium = ?", f.medium);
  if (f.act) add("p.act = ?", f.act);
  if (f.place) add("p.place = ?", f.place);
  if (f.pov) parts.push("p.pov");
  if (f.from === "date") parts.push("p.from_date");
  if (f.from === "studio") parts.push("not p.from_date");
  // The side is the post's rating, never where it was made: an SFW twin kept in After Dark is safe for work.
  if (!opts.anySide) parts.push(sideOf(f) === "after_dark" ? "p.rating = 'nsfw'" : "p.rating <> 'nsfw'");
  if (f.shape) add("coalesce(p.aspect, '3:4') = ?", f.shape);
  if (f.following) add("exists (select 1 from creator_follows fo where fo.creator_id = p.owner_id and fo.follower_id = ?)", v.id ?? "");
  return { sql: parts.join(" and "), args };
}

const FROM = `from showcase_posts p
  join creator_profiles cp on cp.user_id = p.owner_id
  join characters c on c.id = p.character_id
  left join characters cb on cb.id = p.character_b`;

/** One page of the showcase for this viewer and these filters, newest first. `pageSize`: the reels' smaller pages. */
export async function listShowcase(db: Db, v: ShowcaseViewer, f: Filters = {}, opts: { pageSize?: number } = {}): Promise<{ posts: Post[]; more: boolean }> {
  const w = where(v, f);
  const page = Math.max(1, Math.floor(f.page ?? 1));
  const size = opts.pageSize ?? PAGE_SIZE;
  w.args.push(size + 1, (page - 1) * size, v.id ?? "");
  const n = w.args.length;
  // Trending: the most liked this week, then the newest.
  const order = f.sort === "trending" ? "(select count(*) from showcase_likes l where l.post_id = p.id and l.created_at > now() - interval '7 days') desc, p.published_at desc nulls last, p.id" : "p.published_at desc nulls last, p.id";
  const { rows } = await db.query<Omit<Post, "creator" | "character" | "partner" | "published_at" | "mine" | "mime"> & {
    handle: string; display_name: string; character_id: string; character_name: string; character_b: string | null; partner_name: string | null; published_at: Date; owner_id: string; mime: string | null;
    likes: number; liked: boolean; remixable: boolean;
  }>(
    `select p.id, p.source, p.media_id, p.rating, p.medium, p.aspect, p.act, p.place, p.pov, p.from_date, p.caption, p.status, p.published_at, p.owner_id, (p.remix is not null) as remixable,
            cp.handle, cp.display_name, p.character_id, c.name as character_name, p.character_b, cb.name as partner_name,
            coalesce((select i.mime from adult_images i where p.source = 'after_dark' and i.id = p.media_id and i.status = 'ready'),
                     (select g.mime from studio_pg_pictures g where p.source = 'pg' and g.id = p.media_id)) as mime,
            (select count(*)::int from showcase_likes l where l.post_id = p.id) as likes,
            exists (select 1 from showcase_likes l where l.post_id = p.id and l.user_id = $${n}) as liked
       ${FROM}
      where ${w.sql}
      order by ${order}
      limit $${n - 2} offset $${n - 1}`,
    w.args,
  );
  const posts = rows
    .filter((r) => r.mime)
    .map((r) => ({
      id: r.id, source: r.source, media_id: r.media_id, mime: r.mime!, rating: r.rating, medium: r.medium, aspect: r.aspect, act: r.act, place: r.place, pov: r.pov, from_date: r.from_date,
      caption: r.caption, status: r.status, published_at: new Date(r.published_at).toISOString(),
      creator: { handle: r.handle, display_name: r.display_name }, character: { id: r.character_id, name: r.character_name },
      partner: r.character_b ? { id: r.character_b, name: r.partner_name ?? "" } : null, mine: Boolean(v.id && r.owner_id === v.id),
      likes: r.likes, liked: r.liked, remixable: r.remixable,
    }));
  return { posts: posts.slice(0, size), more: rows.length > size };
}

/**
 * How many of each character's posts are After Dark's, for someone who can't see them (the reels' "🌙 N more of them
 * after dark", which leads to the subscription, or the waitlist until it opens). Counts only, never a picture; nothing
 * for someone who can see them already, or for a bot.
 */
export async function afterDarkCounts(db: Db, v: ShowcaseViewer, characterIds: readonly string[]): Promise<Record<string, number>> {
  if (!characterIds.length || v.bot || v.ratings.includes("nsfw")) return {};
  const { rows } = await db.query<{ id: string; n: number }>(
    `select x.id, count(*)::int as n from (
       select p.character_id as id ${FROM} where p.status = 'live' and not p.held and not cp.hidden and p.rating = 'nsfw' and p.character_id = any($1::text[])
       union all
       select p.character_b ${FROM} where p.status = 'live' and not p.held and not cp.hidden and p.rating = 'nsfw' and p.character_b = any($1::text[])
     ) x group by 1`,
    [[...new Set(characterIds)]],
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.n]));
}

export type Facets = {
  medium: [string, number][]; act: [string, number][]; place: [string, number][]; character: [string, string, number][]; shape: [string, number][];
  from: [string, number][]; pov: number;
  /** How many on each side, with every other filter applied. */
  sides: { pg: number; after_dark: number };
};

/**
 * What there is to filter by among what this viewer can see: each value and its count. A row's counts leave out that
 * row's own pick (with a place picked, the other places still show what they'd find), and keep every other filter.
 */
export async function showcaseFacets(db: Db, v: ShowcaseViewer, f: Filters = {}): Promise<Facets> {
  const without = (...keys: (keyof Filters)[]): Filters => {
    const g: Filters = { ...f, page: undefined };
    for (const k of keys) delete g[k];
    return g;
  };
  const count = async (col: string, g: Filters) => {
    const w = where(v, g);
    return (await db.query<{ k: string; n: number }>(`select ${col} as k, count(*)::int as n ${FROM} where ${w.sql} and ${col} is not null group by 1 order by 2 desc limit 24`, w.args)).rows.map((r) => [r.k, r.n] as [string, number]);
  };
  const wc = where(v, without("character"));
  const characters = (
    await db.query<{ id: string; name: string; n: number }>(
      `select x.id, x.name, count(*)::int as n from (select c.id, c.name ${FROM} where ${wc.sql} union all select cb.id, cb.name ${FROM} where ${wc.sql} and cb.id is not null) x group by 1, 2 order by 3 desc limit 24`,
      wc.args,
    )
  ).rows.map((r) => [r.id, r.name, r.n] as [string, string, number]);
  const wp = where(v, without("pov"));
  const pov = (await db.query<{ n: number }>(`select count(*)::int as n ${FROM} where ${wp.sql} and p.pov`, wp.args)).rows[0].n;
  const ws = where(v, without("side"), { anySide: true });
  const sides = (await db.query<{ nsfw: number; safe: number }>(`select count(*) filter (where p.rating = 'nsfw')::int as nsfw, count(*) filter (where p.rating <> 'nsfw')::int as safe ${FROM} where ${ws.sql}`, ws.args)).rows[0];
  return {
    medium: await count("p.medium", without("medium")),
    act: await count("p.act", without("act")),
    place: await count("p.place", without("place")),
    character: characters,
    shape: await count("coalesce(p.aspect, '3:4')", without("shape")),
    from: await count("case when p.from_date then 'date' else 'studio' end", without("from")),
    pov,
    sides: { pg: sides.safe, after_dark: sides.nsfw },
  };
}

/* -------------------------------------------------- the bytes -------------------------------------------------- */

/** A post's item for this viewer: live (or theirs, or an admin's look), of a rating they may see. Null otherwise. */
export async function postMedia(db: Db, v: ShowcaseViewer, postId: string): Promise<{ source: ShowcaseSource; media_id: string; rating: ContentRating } | null> {
  const r = (await db.query<{ source: ShowcaseSource; media_id: string; rating: string; status: string; owner_id: string; held: boolean }>(`select source, media_id, rating, status, owner_id, held from showcase_posts where id = $1`, [postId])).rows[0];
  if (!r) return null;
  // Held by a serious report: only its creator and the moderators, until an admin looks.
  if (r.held && !v.admin && !(v.id && r.owner_id === v.id)) return null;
  const rating = ratingOf(r.rating);
  const mine = Boolean(v.id && r.owner_id === v.id);
  // Asked for their OK: they see what they're asked about (an explicit one only if After Dark is open to them).
  const asked = Boolean(v.id && !mine && (await db.query(`select 1 from showcase_consents where post_id = $1 and owner_id = $2`, [postId, v.id])).rows.length);
  if (asked && (rating !== "nsfw" || v.adult)) return { source: r.source, media_id: r.media_id, rating };
  if (!mine && !v.admin && r.status !== "live") return null;
  if (!mine && !v.ratings.includes(rating)) return null;
  return { source: r.source, media_id: r.media_id, rating };
}

/* -------------------------------------------------- publishing the best -------------------------------------------------- */

/**
 * The owner's best work, to publish in one go (David, 2026-10-29: "add all the assets we have so far that have a good
 * rating as the baseline for the showcase so it's not empty"): their own pictures and clips they 👍'd or an admin gave
 * 4 or 5 stars (a clip of a reel given 4 or 5 too), never one 👎'd or given 1 to 3 stars or taken out to the Archive,
 * and their PG Studio pictures rated pg. Never a picture with someone else's character: that needs its owner's OK,
 * asked one post at a time, never in bulk on someone's behalf. The SFW twin of a picture in it (lib/adult/sfw-twin.ts,
 * rated pg or suggestive) is in it too: it's the same good picture, dressed, for the side everyone sees.
 */
export async function bestOf(db: Db, owner: string): Promise<{ after_dark: string[]; pg: string[] }> {
  const ad = (
    await db.query<{ id: string }>(
      `select i.id from adult_images i
         join characters c on c.id = i.character_id
         left join characters cb on cb.id = i.character_b
        where i.owner_id = $1 and i.status = 'ready' and i.kind in ('scene', 'baseline', 'video')
          and (c.is_house or c.owner_id = $1) and (cb.id is null or cb.is_house or cb.owner_id = $1)
          and (exists (select 1 from adult_media_thumbs t where t.media_id = i.id and t.owner_id = $1 and t.rating = 1)
               or exists (select 1 from adult_media_ratings r where r.item_id = i.id and r.rating >= 4)
               or exists (select 1 from adult_reels v cross join lateral jsonb_array_elements(v.shots) s
                           join adult_media_ratings r on r.item_id = v.id and r.item_kind = 'reel' and r.rating >= 4
                          where v.owner_id = $1 and s->>'media_id' = i.id))
          and not exists (select 1 from adult_media_thumbs t where t.media_id = i.id and t.rating = -1)
          and not exists (select 1 from adult_media_ratings r where r.item_id = i.id and r.rating <= 3)
          and not exists (select 1 from adult_reels v cross join lateral jsonb_array_elements(v.shots) s
                           where v.owner_id = $1 and s->>'media_id' = i.id and s ? 'archived_at')
        order by i.created_at`,
      [owner],
    )
  ).rows.map((r) => r.id);
  const twins = (
    await db.query<{ id: string }>(
      `select id from adult_images where owner_id = $1 and twin_of = any($2::text[]) and status = 'ready' and content_rating in ('pg', 'suggestive') order by created_at`,
      [owner, ad],
    )
  ).rows.map((r) => r.id);
  const pg = (
    await db.query<{ id: string }>(`select id from studio_pg_pictures where owner_id = $1 and (content_rating = 'pg' or twin_of = any($2::text[])) order by created_at`, [owner, ad])
  ).rows.map((r) => r.id);
  return { after_dark: [...ad, ...twins.filter((id) => !ad.includes(id))], pg };
}

/**
 * Their best pictures (bestOf) with no SFW twin yet, best first (most stars, then newest): what "Make SFW twins of my
 * best" works through (David, 2026-10-29, to fill the side of the showcase everyone sees). Never a twin of a twin, nor
 * a clip.
 */
export async function twinCandidates(db: Db, owner: string): Promise<string[]> {
  const best = (await bestOf(db, owner)).after_dark;
  if (!best.length) return [];
  return (
    await db.query<{ id: string }>(
      `select i.id from adult_images i
        where i.id = any($2::text[]) and i.owner_id = $1 and i.status = 'ready' and i.kind in ('scene', 'baseline') and i.mime like 'image/%' and i.twin_of is null
          and not exists (select 1 from adult_images t where t.twin_of = i.id and t.status = 'ready')
          and not exists (select 1 from studio_pg_pictures p where p.twin_of = i.id)
        order by (select max(r.rating) from adult_media_ratings r where r.item_id = i.id) desc nulls last, i.created_at desc`,
      [owner, best],
    )
  ).rows.map((r) => r.id);
}

/** How many twins are drawn at once: each is an edit of a minute or so, and a batch has to fit in one request. */
export const TWIN_BATCH = 3;

/**
 * The next few twins of their best (twinCandidates), drawn together through sfwTwin, so every rule of a twin holds:
 * safe mode, the PG check, admins free and anyone else paying for each. `skip`: ones that didn't come through
 * earlier, so a run moves on past them. Each one made is left for "Publish my best work" to post.
 */
export async function twinBest(
  db: Db,
  owner: string,
  baseUrl: string,
  skip: readonly string[] = [],
): Promise<{ ok: true; made: { original: string; id: string; where: "pg" | "after_dark" }[]; failed: { original: string; message: string }[]; left: number }> {
  const todo = (await twinCandidates(db, owner)).filter((id) => !skip.includes(id));
  const batch = todo.slice(0, TWIN_BATCH);
  const { sfwTwin } = await import("./adult/sfw-twin");
  const results = await Promise.all(batch.map((id) => sfwTwin(db, owner, id, baseUrl).catch((err: unknown) => ({ ok: false as const, status: 500, error: "error", message: err instanceof Error ? err.message.slice(0, 160) : "error" }))));
  const made: { original: string; id: string; where: "pg" | "after_dark" }[] = [];
  const failed: { original: string; message: string }[] = [];
  results.forEach((r, i) => {
    if (r.ok) made.push({ original: batch[i], id: r.picture.id, where: r.where });
    else failed.push({ original: batch[i], message: r.message });
  });
  return { ok: true, made, failed, left: todo.length - batch.length };
}

/** Publishes the owner's best (bestOf) under their handle: each as one post would be, those already up left as they are. */
export async function publishBest(db: Db, owner: string): Promise<{ ok: true; published: number; already: number; failed: number } | Fail> {
  if (!(await creatorProfile(db, owner))) return fail(409, "no_profile", "Pick your creator handle first.");
  const best = await bestOf(db, owner);
  const existing = new Set(
    (await db.query<{ media_id: string }>(`select media_id from showcase_posts where owner_id = $1`, [owner])).rows.map((r) => r.media_id),
  );
  let published = 0;
  let already = 0;
  let failed = 0;
  for (const [source, ids] of [["after_dark", best.after_dark], ["pg", best.pg]] as const) {
    for (const media_id of ids) {
      if (existing.has(media_id)) {
        already++;
        continue;
      }
      const r = await publish(db, owner, { source, media_id });
      if (r.ok) published++;
      else failed++;
    }
  }
  return { ok: true, published, already, failed };
}
