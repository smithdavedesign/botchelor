/**
 * After Dark Shorts (David, 2026-10-22, from the competitor read: "nobody in the market does these, because they're 1:1
 * companions"). An admin publishes one of their saved nights between two of this season's house characters as an
 * episode: a title, a cover (a picture or keyframe of the two of them that passed the output check before it was
 * stored), the night itself (its chapters, to read or play in the theater) and the night's video when it has one.
 *
 * Who sees what (docs/after-dark.md "Shorts"):
 *  - an entitled viewer (canAfterDark, and After Dark available here) watches them: included in the subscription, no
 *    tokens. The night's lines and videos go only to someone who has pressed play (adult_short_views), so a Short's
 *    ending can't be read before it's watched (the predictions, lib/adult/predictions.ts, lock at that moment);
 *  - everyone else gets the blurred teaser: the title (held to the show's PG check when it's published, since it shows
 *    outside the paywall), the pair's names, the length, and neutral filler under the blur, never a line or a picture;
 *  - bots get nothing (the pages answer not found).
 *
 * A Short is a whole night: the saved chapters filed one after another (chapter 1, then 2, 3…) until Start over ended
 * it. A night still running can't be published, so a Short never changes after it's published: what it points at is
 * fixed then (the nights, the cover, the videos), and nothing it shows carries the owner's private notes (each line's
 * why, memory and facts; publicLines).
 */
import { isAdmin } from "../admins";
import type { Db } from "../db";
import { pairKey } from "../relationships";
import { checkAdultText, checkShowText } from "../safety";
import { seasonCastIds } from "../season-cast";
import type { PlaceStop } from "./continuity";
import { canAfterDark } from "./entitlement";
import { adultAvailable, adultViewerFromCookies } from "./mode";
import { spoken, type ReelShot } from "./reels";
import { dropForeignActions, publicLines, type SceneLine } from "./scenes";

export const SHORT_TITLE_MAX = 80;
/** A night shorter than this isn't an episode. */
export const SHORT_MIN_LINES = 6;
const COVERS_LISTED = 60;
const SHORTS_LISTED = 60;

type Auth = { userId: string; authenticated: boolean } | null;
type CookieStore = { get(name: string): { value: string } | undefined };

/**
 * What a visitor gets of the Shorts: the whole thing (an entitled viewer, After Dark open here), the teaser (anyone it
 * isn't open to), the admin's "it's off" note, or nothing at all (entitled, but After Dark isn't available, or the device
 * is locked: as on /after-dark). Bots are turned away before this, by the pages.
 */
export type ShortsAccess = { kind: "full"; viewer: string; admin: boolean } | { kind: "teaser" } | { kind: "off" } | { kind: "hidden" };

export async function shortsAccess(db: Db, auth: Auth, store: CookieStore): Promise<ShortsAccess> {
  const viewer = await adultViewerFromCookies(db, store);
  if (viewer) return { kind: "full", viewer, admin: await isAdmin(db, viewer) };
  const entitled = await canAfterDark(db, auth);
  if (!entitled.ok) return { kind: "teaser" };
  return entitled.why === "admin" && !(await adultAvailable(db)) ? { kind: "off" } : { kind: "hidden" };
}

/** Both of them on this season's house cast (lib/season-cast.ts): the only characters a Short can have. */
export async function housePair(db: Db, x: string, y: string, now: Date = new Date()): Promise<boolean> {
  if (!x || !y || x === y) return false;
  const cast = new Set(seasonCastIds(now));
  if (!cast.has(x) || !cast.has(y)) return false;
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from characters where id = any($1) and is_house`, [[x, y]]);
  return rows[0]?.n === 2;
}

/** A saved chapter of a night (adult_nights), as a Short reads it. */
export type NightRow = {
  id: string;
  lines: SceneLine[] | null;
  place: string | null;
  stage: number | null;
  date_setting: string | null;
  date_venue: string | null;
  set_place: string | null;
  chapter: number | null;
  place_history: PlaceStop[] | null;
  created_at: string | Date;
};
const NIGHT_COLUMNS = "id, lines, place, stage, date_setting, date_venue, set_place, chapter, place_history, created_at";

/**
 * A whole night: its saved chapters in order. `complete` is false while it's still running (its next chapter is the
 * scene being written now). `since` and `until` bound when it was filed: the end of the night before, and its own last
 * chapter (the pictures drawn in between are the night's).
 */
export type NightGroup = { id: string; rows: NightRow[]; complete: boolean; since: Date | null; until: Date };

/**
 * The saved chapters (oldest first) as nights: chapter 1, or an unnumbered night from before chapters, starts one, and
 * chapter n+1 filed after chapter n carries it on. The latest night is still running when the pair's scene is on its
 * next chapter (a chapter closed and the night ran on); Start over sets the scene back to chapter 1, which ends it.
 */
export function groupNights(rows: readonly NightRow[], running: { chapter: number } | null): NightGroup[] {
  const groups: NightGroup[] = [];
  for (const r of rows) {
    const open = groups.at(-1);
    const last = open?.rows.at(-1);
    const follows = open && typeof r.chapter === "number" && r.chapter > 1 && typeof last?.chapter === "number" && r.chapter === last.chapter + 1;
    if (follows) {
      open.rows.push(r);
      open.until = new Date(r.created_at);
    } else {
      groups.push({ id: r.id, rows: [r], complete: true, since: open?.until ?? null, until: new Date(r.created_at) });
    }
  }
  const latest = groups.at(-1);
  const ended = latest?.rows.at(-1)?.chapter;
  if (latest && running && typeof ended === "number" && running.chapter === ended + 1) latest.complete = false;
  return groups;
}

/** This person's nights of the pair (lower id first), oldest first. */
export async function pairNights(db: Db, ownerId: string, pair: [string, string]): Promise<NightGroup[]> {
  const [rows, running] = await Promise.all([
    db.query<NightRow>(`select ${NIGHT_COLUMNS} from adult_nights where owner_id = $1 and character_a = $2 and character_b = $3 order by created_at, chapter nulls first, id`, [ownerId, ...pair]),
    db.query<{ chapter: number }>(`select chapter from adult_scenes where owner_id = $1 and character_a = $2 and character_b = $3`, [ownerId, ...pair]),
  ]);
  return groupNights(rows.rows, running.rows[0] ?? null);
}

const lineCount = (rows: readonly NightRow[]) => rows.reduce((n, r) => n + (r.lines?.length ?? 0), 0);

/** A picture that can be a Short's cover: one of the two of them (a scene picture of both, or a reel's keyframe). */
export type CoverOption = { id: string; kind: "scene" | "frame"; created_at: string; chapter: number | null; place: string | null };

/**
 * The covers this person can pick for the pair: their own pictures and keyframes of the two of them together. Every one
 * passed the output check (Hive moderation and the age question) before it was stored: nothing else is ever stored.
 */
export async function coverOptions(db: Db, ownerId: string, pair: [string, string]): Promise<CoverOption[]> {
  const { rows } = await db.query<CoverOption & { created_at: string | Date }>(
    `select id, kind, created_at, scene_chapter as chapter, scene_place as place from adult_images
      where owner_id = $1 and status = 'ready' and kind in ('scene', 'frame') and mime like 'image/%'
        and ((character_id = $2 and character_b = $3) or (character_id = $3 and character_b = $2))
      order by created_at desc, id limit ${COVERS_LISTED}`,
    [ownerId, ...pair],
  );
  return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
}

/**
 * The cover a night starts with: its earliest picture (drawn while they were still at the start, it gives away nothing
 * of how the night goes, and it shows before anyone predicts it), else the latest one before it ended, else none.
 */
export function defaultCover(group: Pick<NightGroup, "since" | "until">, options: readonly CoverOption[]): string | null {
  const t = (o: CoverOption) => new Date(o.created_at).getTime();
  const during = options.filter((o) => (!group.since || t(o) > group.since.getTime()) && t(o) <= group.until.getTime()).sort((p, q) => t(p) - t(q));
  if (during.length) return during[0].id;
  return options.filter((o) => t(o) <= group.until.getTime()).sort((p, q) => t(q) - t(p))[0]?.id ?? null;
}

const readyShots = (shots: readonly ReelShot[] | null | undefined) => (shots ?? []).filter((s) => s.status === "ready" && s.media_id);

/**
 * Whether a video filmed these lines: every shot of it that came through says one of them, by the same one of the two,
 * at its own place in the lines (lib/adult/reels.ts makes a shot's text from its line as `spoken` does).
 */
export function filmed(lines: readonly SceneLine[], shots: readonly ReelShot[]): boolean {
  const ready = readyShots(shots);
  return (
    ready.length > 0 &&
    ready.every((s) => {
      const l = lines[s.line];
      return Boolean(l) && l.who === s.who && spoken(dropForeignActions(l.text)).speech === s.text;
    })
  );
}

/** The night's videos: for each chapter, the newest video of the night (never a clip) that filmed its lines. */
export async function nightVideos(db: Db, ownerId: string, pair: [string, string], rows: readonly NightRow[]): Promise<string[]> {
  const { rows: reels } = await db.query<{ id: string; shots: ReelShot[] | null }>(
    `select id, shots from adult_reels where owner_id = $1 and character_a = $2 and character_b = $3 and coalesce(kind, 'night') <> 'clip' and status <> 'making'
      order by created_at desc, id limit 40`,
    [ownerId, ...pair],
  );
  const out: string[] = [];
  for (const r of rows) {
    const reel = reels.find((x) => !out.includes(x.id) && filmed(r.lines ?? [], x.shots ?? []));
    if (reel) out.push(reel.id);
  }
  return out;
}

/** A Short as its owner manages it. */
export type AdminShort = { id: string; night_id: string; title: string; cover_id: string | null; videos: number; published: boolean; published_at: string | null; path: string };

type ShortRow = {
  id: string;
  owner_id: string;
  character_a: string;
  character_b: string;
  night_id: string;
  night_ids: string[];
  title: string;
  cover_id: string | null;
  reel_ids: string[];
  published_at: string | Date | null;
  created_at: string | Date;
};
const SHORT_COLUMNS = "id, owner_id, character_a, character_b, night_id, night_ids, title, cover_id, reel_ids, published_at, created_at";

export const shortPath = (id: string) => `/after-dark/shorts/${id}`;
const iso = (d: string | Date | null) => (d ? new Date(d).toISOString() : null);
const adminShort = (r: ShortRow): AdminShort => ({
  id: r.id,
  night_id: r.night_id,
  title: r.title,
  cover_id: r.cover_id,
  videos: (r.reel_ids ?? []).length,
  published: Boolean(r.published_at),
  published_at: iso(r.published_at),
  path: shortPath(r.id),
});

export type ShortResult = { ok: true; short: AdminShort } | { ok: false; status: number; error: string; message: string };
const refuse = (status: number, error: string, message: string): ShortResult => ({ ok: false, status, error, message });

/** The title as typed: one line, trimmed. */
export const cleanTitle = (raw: string): string => raw.replace(/\s+/g, " ").trim();

const HOUSE_ONLY = "A Short is two of this season's house cast: both of them have to be on it.";

/** A night of the pair's, ready to publish, and the Shorts already made from them: what the admin's panel shows. */
export type NightOption = {
  id: string;
  chapters: number;
  lines: number;
  ended: string | null;
  filed_at: string;
  complete: boolean;
  cover: string | null;
  videos: number;
  short: AdminShort | null;
  /** How many have pressed play on its Short. */
  views: number;
  suggested_title: string;
};
export type ShortsPanel = { allowed: boolean; why: string | null; nights: NightOption[]; covers: CoverOption[] };

const firstName = (name: string) => name.split(/\s+/)[0] ?? name;

/** The admin's panel for a pair: their nights (newest first) with what each would publish, and the covers to pick from. */
export async function shortsPanel(db: Db, adminId: string, x: string, y: string): Promise<ShortsPanel | null> {
  if (!(await isAdmin(db, adminId)) || !x || !y || x === y) return null;
  const pair = pairKey(x, y);
  if (!(await housePair(db, ...pair))) return { allowed: false, why: HOUSE_ONLY, nights: [], covers: [] };
  const [groups, covers, made, names] = await Promise.all([
    pairNights(db, adminId, pair),
    coverOptions(db, adminId, pair),
    db.query<ShortRow>(`select ${SHORT_COLUMNS} from adult_shorts where owner_id = $1 and character_a = $2 and character_b = $3`, [adminId, ...pair]),
    db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [pair]),
  ]);
  const name = (id: string) => firstName(names.rows.find((r) => r.id === id)?.name ?? id);
  const views = await shortViews(db, made.rows.map((s) => s.id));
  const nights: NightOption[] = [];
  for (const g of [...groups].reverse()) {
    const last = g.rows.at(-1)!;
    const short = made.rows.find((s) => s.night_id === g.id);
    nights.push({
      id: g.id,
      chapters: g.rows.length,
      lines: lineCount(g.rows),
      ended: last.set_place ?? last.place,
      filed_at: g.until.toISOString(),
      complete: g.complete,
      cover: short?.cover_id ?? defaultCover(g, covers),
      videos: g.complete ? (await nightVideos(db, adminId, pair, g.rows)).length : 0,
      short: short ? adminShort(short) : null,
      views: short ? (views.get(short.id) ?? 0) : 0,
      suggested_title: `${name(pair[0])} and ${name(pair[1])}${g.rows[0].date_setting ? `, after ${g.rows[0].date_setting}` : ", after dark"}`.slice(0, SHORT_TITLE_MAX),
    });
  }
  return { allowed: true, why: null, nights, covers };
}

export type PublishInput = { a: string; b: string; night_id: string; title: string; cover_id?: string | null; video?: boolean };

/**
 * Publishes one of the admin's saved nights of two house characters as a Short (or, published already, changes its
 * title, cover or video). Only a signed-in admin's route calls this; it checks again that they're an admin and that the
 * night is theirs, whole (not still running) and long enough, and that the title passes both the two lines and the
 * show's PG check (it shows on the teaser, outside the paywall).
 */
export async function publishShort(db: Db, adminId: string, input: PublishInput): Promise<ShortResult> {
  if (!(await isAdmin(db, adminId))) return refuse(404, "not_found", "Not found.");
  if (!(await housePair(db, input.a, input.b))) return refuse(409, "not_house_cast", HOUSE_ONLY);
  const pair = pairKey(input.a, input.b);
  const group = (await pairNights(db, adminId, pair)).find((g) => g.rows.some((r) => r.id === input.night_id));
  if (!group) return refuse(404, "night_not_found", "That isn't one of your saved nights of these two.");
  if (!group.complete) return refuse(409, "night_running", "This night is still going. Start over files it as a whole night; then it can be a Short.");
  if (lineCount(group.rows) < SHORT_MIN_LINES) return refuse(409, "too_short", `A Short needs a night of at least ${SHORT_MIN_LINES} lines.`);
  const title = cleanTitle(input.title);
  if (!title || title.length > SHORT_TITLE_MAX) return refuse(400, "invalid_title", `Give it a title, up to ${SHORT_TITLE_MAX} characters.`);
  if (!checkAdultText({ title }).ok) return refuse(422, "title_refused", "That title crosses one of the lines that never move.");
  if (!checkShowText({ title }).ok) {
    return refuse(422, "title_not_pg", "The title shows on the teaser, outside the paywall, so it stays PG: nothing sexual and no innuendo.");
  }
  const cover = input.cover_id ?? null;
  if (cover && !(await coverOptions(db, adminId, pair)).some((o) => o.id === cover)) {
    return refuse(422, "invalid_cover", "The cover has to be one of your pictures of the two of them (they all passed the check).");
  }
  const reels = input.video === false ? [] : await nightVideos(db, adminId, pair, group.rows);
  const { rows } = await db.query<ShortRow>(
    `insert into adult_shorts (id, owner_id, character_a, character_b, night_id, night_ids, title, cover_id, reel_ids, published_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, now())
     on conflict (night_id) do update set title = excluded.title, cover_id = excluded.cover_id, reel_ids = excluded.reel_ids,
            published_at = coalesce(adult_shorts.published_at, now()), updated_at = now()
      where adult_shorts.owner_id = excluded.owner_id
     returning ${SHORT_COLUMNS}`,
    [crypto.randomUUID(), adminId, ...pair, group.id, JSON.stringify(group.rows.map((r) => r.id)), title, cover, JSON.stringify(reels)],
  );
  return rows[0] ? { ok: true, short: adminShort(rows[0]) } : refuse(404, "not_found", "Not found.");
}

/** Takes a Short down (the admin's undo: viewers no longer see it, or its teaser), or puts it back up. */
export async function setShortPublished(db: Db, adminId: string, id: string, published: boolean): Promise<ShortResult> {
  if (!(await isAdmin(db, adminId))) return refuse(404, "not_found", "Not found.");
  const row = (await db.query<ShortRow>(`select ${SHORT_COLUMNS} from adult_shorts where id = $1 and owner_id = $2`, [id, adminId])).rows[0];
  if (!row) return refuse(404, "not_found", "No Short of yours with that id.");
  if (published && !(await housePair(db, row.character_a, row.character_b))) return refuse(409, "not_house_cast", HOUSE_ONLY);
  const { rows } = await db.query<ShortRow>(
    `update adult_shorts set published_at = case when $2::boolean then coalesce(published_at, now()) else null end, updated_at = now() where id = $1 returning ${SHORT_COLUMNS}`,
    [id, published],
  );
  return { ok: true, short: adminShort(rows[0]) };
}

/** A Short as the list shows it. Nothing that gives the night away: no stage, no place, no chapter count. */
export type ShortCard = {
  id: string;
  title: string;
  a: { id: string; name: string };
  b: { id: string; name: string };
  lines: number;
  video: boolean;
  /** The cover's address (the Short's own media route), for an entitled viewer; null without one. */
  cover: string | null;
  published_at: string | null;
  path: string;
};
/** The same for the teaser: no cover, nothing that could show what happens. */
export type ShortTeaser = Omit<ShortCard, "cover" | "video">;

export const shortMediaUrl = (shortId: string, mediaId: string) => `/api/admin/after-dark/shorts/${encodeURIComponent(shortId)}/media/${encodeURIComponent(mediaId)}`;

type CardRow = ShortRow & { an: string; bn: string; lines: number };
const CARD_SELECT = `select s.id, s.owner_id, s.character_a, s.character_b, s.night_id, s.night_ids, s.title, s.cover_id, s.reel_ids, s.published_at, s.created_at,
         ca.name as an, cb.name as bn,
         coalesce((select sum(jsonb_array_length(n.lines)) from adult_nights n where n.id in (select jsonb_array_elements_text(s.night_ids))), 0)::int as lines
    from adult_shorts s
    join characters ca on ca.id = s.character_a
    join characters cb on cb.id = s.character_b`;

const cardOf = (r: CardRow): ShortCard => ({
  id: r.id,
  title: r.title,
  a: { id: r.character_a, name: r.an },
  b: { id: r.character_b, name: r.bn },
  lines: r.lines,
  video: (r.reel_ids ?? []).length > 0,
  cover: r.cover_id ? shortMediaUrl(r.id, r.cover_id) : null,
  published_at: iso(r.published_at),
  path: shortPath(r.id),
});

/** The published Shorts, newest first. */
export async function listShorts(db: Db, limit = SHORTS_LISTED): Promise<ShortCard[]> {
  const { rows } = await db.query<CardRow>(`${CARD_SELECT} where s.published_at is not null order by s.published_at desc, s.id limit $1`, [limit]);
  return rows.map(cardOf);
}

/** Only what may show outside the paywall: the title (PG-checked when it was published), the two names, the length. */
const teaserOf = (c: ShortCard): ShortTeaser => ({ id: c.id, title: c.title, a: c.a, b: c.b, lines: c.lines, published_at: c.published_at, path: c.path });

/** The teaser's cards: the published Shorts, newest first. */
export async function teaserShorts(db: Db, limit = SHORTS_LISTED): Promise<ShortTeaser[]> {
  return (await listShorts(db, limit)).map(teaserOf);
}

/** One Short, if this viewer may see it: published, or their own (or any, for an admin) while it's down. */
async function visibleShort(db: Db, viewer: string | null, id: string): Promise<CardRow | null> {
  const r = (await db.query<CardRow>(`${CARD_SELECT} where s.id = $1`, [id])).rows[0];
  if (!r) return null;
  if (r.published_at) return r;
  return viewer && (viewer === r.owner_id || (await isAdmin(db, viewer))) ? r : null;
}

/** The teaser for one published Short (null for one taken down, or none). */
export async function teaserShort(db: Db, id: string): Promise<ShortTeaser | null> {
  const r = (await db.query<CardRow>(`${CARD_SELECT} where s.id = $1 and s.published_at is not null`, [id])).rows[0];
  return r ? teaserOf(cardOf(r)) : null;
}

/** One line as a viewer gets it: who and what, and how far it had gone (never why, memory or facts). */
export type ShortLine = { who: "a" | "b"; text: string; stage?: number };
export type ShortChapter = { chapter: number; lines: ShortLine[]; place: string | null };
/** A shot of the night's video, by the Short's own media route. */
export type ShortShot = { video: string; audio: string | null; poster: string | null; text: string; who: "a" | "b" };
export type ShortEpisode = {
  chapters: ShortChapter[];
  /** Where it started (their date's venue) and where it ended up, for the theater's stage. */
  date_venue: string | null;
  place: string | null;
  set: string | null;
  stage: number;
  video: ShortShot[];
};

/** The Short as its viewer sees it once they've pressed play, and whether they may (owner, admin, or watched). */
export type ShortView = ShortCard & { owner: boolean; watched: boolean; episode: ShortEpisode | null };

/** A Short's saved chapters, in the order it was published with. */
async function shortNights(db: Db, r: Pick<ShortRow, "night_ids">): Promise<NightRow[]> {
  const ids = r.night_ids ?? [];
  const { rows } = await db.query<NightRow>(`select ${NIGHT_COLUMNS} from adult_nights where id = any($1)`, [ids]);
  return ids.map((id) => rows.find((n) => n.id === id)).filter((n): n is NightRow => Boolean(n));
}

/** A Short's chapters with everything stored on their lines (moved_to included): the server's own reading, never sent. */
export async function shortLines(db: Db, id: string): Promise<{ rows: NightRow[]; short: Pick<ShortRow, "id" | "owner_id" | "character_a" | "character_b" | "night_ids"> } | null> {
  const r = (await db.query<ShortRow>(`select ${SHORT_COLUMNS} from adult_shorts where id = $1`, [id])).rows[0];
  return r ? { rows: await shortNights(db, r), short: r } : null;
}

const viewerLine = (l: SceneLine): ShortLine => {
  const [pub] = publicLines([l]);
  return { ...pub, text: dropForeignActions(pub.text) };
};

async function episodeOf(db: Db, r: CardRow): Promise<ShortEpisode> {
  const rows = await shortNights(db, r);
  const reels = (r.reel_ids ?? []).length
    ? (await db.query<{ id: string; shots: ReelShot[] | null }>(`select id, shots from adult_reels where id = any($1)`, [r.reel_ids])).rows
    : [];
  const video = (r.reel_ids ?? []).flatMap((rid) =>
    readyShots(reels.find((x) => x.id === rid)?.shots).map((s) => ({
      video: shortMediaUrl(r.id, s.media_id!),
      audio: s.audio_id ? shortMediaUrl(r.id, s.audio_id) : null,
      poster: s.frame_id ? shortMediaUrl(r.id, s.frame_id) : null,
      text: s.text,
      who: s.who,
    })),
  );
  const last = rows.at(-1);
  return {
    chapters: rows.map((n, i) => ({ chapter: n.chapter ?? i + 1, lines: (n.lines ?? []).map(viewerLine), place: n.set_place ?? n.place })),
    date_venue: rows[0]?.date_venue ?? null,
    place: last?.place ?? null,
    set: last?.set_place ?? null,
    stage: Math.max(0, ...rows.map((n) => n.stage ?? 0)),
    video,
  };
}

export async function hasWatched(db: Db, viewer: string, id: string): Promise<boolean> {
  return (await db.query(`select 1 from adult_short_views where short_id = $1 and user_id = $2`, [id, viewer])).rows.length > 0;
}

/** Which of these Shorts this viewer has pressed play on. */
export async function watchedOf(db: Db, viewer: string, ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { rows } = await db.query<{ short_id: string }>(`select short_id from adult_short_views where user_id = $1 and short_id = any($2)`, [viewer, [...ids]]);
  return new Set(rows.map((r) => r.short_id));
}

/**
 * One Short for an entitled viewer: its card, and the night itself only once they've pressed play (or it's theirs, or
 * they're an admin). Null when it's down or doesn't exist.
 */
export async function viewShort(db: Db, viewer: string, id: string): Promise<ShortView | null> {
  const r = await visibleShort(db, viewer, id);
  if (!r) return null;
  const owner = r.owner_id === viewer;
  const watched = await hasWatched(db, viewer, id);
  const open = owner || watched || (await isAdmin(db, viewer));
  return { ...cardOf(r), owner, watched, episode: open ? await episodeOf(db, r) : null };
}

/** Pressing play: the view is recorded (once), and the night comes back. Null for a Short this viewer can't see. */
export async function watchShort(db: Db, viewer: string, id: string): Promise<ShortView | null> {
  const r = await visibleShort(db, viewer, id);
  if (!r) return null;
  await db.query(`insert into adult_short_views (short_id, user_id) values ($1, $2) on conflict do nothing`, [id, viewer]);
  return { ...cardOf(r), owner: r.owner_id === viewer, watched: true, episode: await episodeOf(db, r) };
}

/**
 * Whether a file may go to this viewer as part of this Short: its cover always (it shows before play); a shot of its
 * videos (the video, its keyframe, its voice) once they've pressed play, or to its owner or an admin.
 */
export async function shortMediaAllowed(db: Db, viewer: string, id: string, mediaId: string): Promise<boolean> {
  const r = await visibleShort(db, viewer, id);
  if (!r || !mediaId) return false;
  if (r.cover_id === mediaId) return true;
  const reels = (r.reel_ids ?? []).length
    ? (await db.query<{ shots: ReelShot[] | null }>(`select shots from adult_reels where id = any($1)`, [r.reel_ids])).rows
    : [];
  const files = new Set(reels.flatMap((x) => readyShots(x.shots).flatMap((s) => [s.media_id, s.audio_id, s.frame_id])).filter(Boolean));
  if (!files.has(mediaId)) return false;
  return r.owner_id === viewer || (await hasWatched(db, viewer, id)) || (await isAdmin(db, viewer));
}

/** How many have pressed play on each of the admin's Shorts (for their panel). */
export async function shortViews(db: Db, ids: readonly string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query<{ short_id: string; n: number }>(`select short_id, count(*)::int as n from adult_short_views where short_id = any($1) group by short_id`, [[...ids]]);
  return new Map(rows.map((r) => [r.short_id, r.n]));
}
