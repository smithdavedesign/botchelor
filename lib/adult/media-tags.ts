/**
 * What each After Dark picture and clip shows, as tags (David, 2026-10-25: "tag the individual assets, together assets,
 * scenes so we can make that mapping and show them in theater mode … also a baseline for a different scene"). One row
 * per tag in adult_media_tags: who's in it (solo or pair), the act (lib/adult/acts.ts ids), the place (PLACES keys), how
 * far it goes (a Studio level, 0–3), the outfit and light, whether it's first-person with the viewer (pov), and whether
 * the owner pinned it for their dates ("date", from the Studio's 📌 Use on dates).
 *
 * Where tags come from (`source`): `choice` (what the picture was made from: a shoot's choices, a beat, a clip's act),
 * `derived` (read from its place or prompt words), `model` (a text model reading the owner's own free words — their
 * custom prompt, per-section extras, a clip's guide; modelTagPending), and `manual` (the owner, as chips). A tag the
 * owner removes is kept as `removed`, so no automatic pass ever puts it back.
 *
 * Tagged as it's made (David, 2026-10-29: "always tag assets on creation to help with filtering and showing in theater
 * during dates for the right time"): every path that keeps a picture or a clip calls tagNow once it's ready (a night's
 * shot videos once the reel is saved, since their tags come from its shot). ensureTagged still runs on every lookup (the
 * theater's match, the Studio, the storyboard's picker): the back-fill of everything made before, and a safety net.
 *
 * The theater and the storyboard rank by these (scoreMedia): the act most, then the place, then who's in it (the pair,
 * then a first-person picture of one of them — the viewer stands in for the partner — then one of them alone), pinned
 * for dates on top, a clip over a still for a backdrop; nothing past how far the night has gone.
 */
import type { Db } from "../db";
import { ACTS } from "./acts";
import { PLACES } from "./tag-labels";
import { positionIn } from "./beats";
import { adultModel } from "./mode";
import { STUDIO_GROUPS, type Level } from "./studio-catalog";

export const TAG_KINDS = ["who", "act", "place", "stage", "outfit", "light", "pov", "date"] as const;
export type TagKind = (typeof TAG_KINDS)[number];
export const TAG_SOURCES = ["choice", "derived", "model", "manual"] as const;
export type TagSource = (typeof TAG_SOURCES)[number];
export type MediaTag = { kind: TagKind; value: string; source: TagSource };

export { PLACES };
const placeKeySet = new Set(PLACES.map((p) => p.key));

/** The place keys a text names (a scene's place, a picture's, the owner's words). */
export function placeKeys(text: string | null | undefined): string[] {
  const t = (text ?? "").toLowerCase().replace(/’/g, "'");
  return t ? PLACES.filter((p) => p.re.test(t)).map((p) => p.key) : [];
}

const ACT_IDS = new Set(ACTS.map((a) => a.id));
/** The Studio's Filthy acts and poses that are one of the shared acts (and which of them are first-person, with the viewer). */
const STUDIO_ACT: Record<string, string> = {
  pov_blowjob: "oral",
  pov_riding: "on_top",
  pov_behind: "behind",
  pov_under: "face_to_face",
  all_fours: "behind",
  face_down: "behind",
  spread_behind: "behind",
  dildo_ride: "on_top",
};
const option = (group: string, id: string | undefined) => (id ? STUDIO_GROUPS.find((g) => g.id === group)?.options.find((o) => o.id === id) : undefined);
/**
 * The Studio's "pov" group (lib/adult/studio-catalog.ts): the picks that are a first-person view with the viewer (a
 * selfie and a mirror shot are of them alone), and the two that are one of the shared acts.
 */
const STUDIO_POV: ReadonlySet<string> = new Set(["looking", "beside", "over", "on_top", "kneel"]);
const STUDIO_POV_ACT: Record<string, string> = { on_top: "on_top", kneel: "oral" };
/** A first-person view of two of them: whose eyes (lib/adult/acts.ts Eyes). */
const isEyes = (v: unknown): v is "a" | "b" => v === "a" || v === "b";

/** How far the night must have gone for a picture of each level to fit it: STAGES index → the highest level it shows. */
export function levelForStage(stage: number): Level {
  return stage >= 4 ? 3 : stage >= 3 ? 2 : stage >= 2 ? 1 : 0;
}
/** A pair picture's night stage as a level. */
const stageLevel = (stage: unknown): Level | null => (typeof stage === "number" ? levelForStage(stage) : null);

/** Everything a media item's tags are read from: the row, and what made it. */
export type TagSourceRow = {
  id: string;
  kind: string;
  mime: string;
  character_b: string | null;
  scene_place: string | null;
  prompt: string;
  preset: string | null;
  shoot_kind: string | null;
  choices: Record<string, unknown> | null;
  beat_act: string | null;
  beat_place: string | null;
  beat_stage: number | null;
  clip: { act?: string | null; place?: string | null; stage?: number; eyes?: string } | null;
  shot: { text?: string; place?: string | null; stage?: number; frame?: string; eyes?: string } | null;
};

/**
 * The tags a media item's own record gives it (`choice` and `derived`), pure: from its shoot, beat, clip or reel shot,
 * its place, and plain words in its prompt. `source` is the picture a clip was made from, already read: a clip shows
 * what its start picture shows.
 */
export function deriveTags(row: TagSourceRow, source: MediaTag[] = []): MediaTag[] {
  const out = new Map<string, MediaTag>();
  const add = (kind: TagKind, value: string | null | undefined, from: TagSource) => {
    if (!value) return;
    const key = `${kind}:${value}`;
    if (!out.has(key)) out.set(key, { kind, value, source: from });
  };
  // A clip from a picture shows what the picture shows (not its level or light: the clip has its own).
  for (const t of source) if (t.kind !== "date") add(t.kind, t.value, t.source);
  add("who", row.character_b ? "pair" : "solo", "choice");
  const c = row.choices ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  if (row.shoot_kind === "pair") {
    if (str(c.act) && ACT_IDS.has(str(c.act)!)) add("act", str(c.act), "choice");
    // Seen through one of their eyes (a Together shoot's view, 2026-10-26): whose.
    if (isEyes(c.eyes)) add("pov", c.eyes, "choice");
    add("stage", String(stageLevel(c.stage) ?? ""), "choice");
    add("outfit", str(c.outfit), "choice");
    add("light", str(c.light), "choice");
    for (const k of placeKeys(option("place", str(c.place))?.label ?? str(c.place))) add("place", k, "choice");
  } else if (row.shoot_kind) {
    // A Studio shoot of one of them (or its variations, upscales and clips: their choices carry `level`).
    const act = STUDIO_ACT[str(c.filthy) ?? ""] ?? STUDIO_ACT[str(c.pose) ?? ""] ?? STUDIO_POV_ACT[str(c.pov) ?? ""];
    add("act", act, "choice");
    // First person with the viewer: a Filthy act that says so, or a pick of the "pov" group that is one.
    if (option("filthy", str(c.filthy))?.withViewer || STUDIO_POV.has(str(c.pov) ?? "")) add("pov", "yes", "choice");
    if (typeof c.level === "number") add("stage", String(c.level), "choice");
    add("outfit", str(c.wardrobe), "choice");
    add("light", str(c.light) ?? row.preset ?? undefined, "choice");
    const placeOpt = option("place", str(c.place));
    for (const k of placeKeys(placeOpt ? `${placeOpt.label} ${placeOpt.words}` : str(c.place))) add("place", k, "choice");
    const extra = (c.extra ?? {}) as Record<string, unknown>;
    for (const k of placeKeys(str(extra.place))) add("place", k, "derived");
  }
  if (row.beat_act && ACT_IDS.has(row.beat_act)) add("act", row.beat_act, "choice");
  for (const k of placeKeys(row.beat_place)) add("place", k, "choice");
  if (row.beat_stage !== null) add("stage", String(levelForStage(row.beat_stage)), "choice");
  if (row.clip) {
    if (row.clip.act && ACT_IDS.has(row.clip.act)) add("act", row.clip.act, "choice");
    if (isEyes(row.clip.eyes)) add("pov", row.clip.eyes, "choice");
    for (const k of placeKeys(row.clip.place)) add("place", k, "choice");
    if (typeof row.clip.stage === "number") add("stage", String(levelForStage(row.clip.stage)), "choice");
  }
  if (row.shot) {
    if (isEyes(row.shot.eyes)) add("pov", row.shot.eyes, "choice");
    for (const k of placeKeys(row.shot.place)) add("place", k, "choice");
    if (typeof row.shot.stage === "number") add("stage", String(levelForStage(row.shot.stage)), "choice");
    add("act", positionIn(`${row.shot.text ?? ""} ${row.shot.frame ?? ""}`), "derived");
  }
  for (const k of placeKeys(row.scene_place)) add("place", k, "derived");
  // Plain words in what it was made from, when nothing better said it.
  if (![...out.values()].some((t) => t.kind === "act")) add("act", positionIn(row.prompt), "derived");
  if (![...out.values()].some((t) => t.kind === "place")) for (const k of placeKeys(row.prompt)) add("place", k, "derived");
  if (row.kind === "baseline") add("stage", "0", "derived");
  return [...out.values()];
}

/** The owner's own free words a media item was made from (custom prompt, per-section extras, a clip's guide), if any. */
export function ownWords(choices: Record<string, unknown> | null): string {
  const c = choices ?? {};
  const extra = c.extra && typeof c.extra === "object" ? Object.values(c.extra as Record<string, unknown>) : [];
  return [c.custom, c.guide, c.dialog, ...extra]
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .join(" ")
    .slice(0, 1200);
}

const CONTEXT_SQL = `
  select i.id, i.kind, i.mime, i.character_b, i.scene_place, i.prompt, i.preset, i.source_image,
         st.kind as shoot_kind, st.choices,
         be.act as beat_act, be.place as beat_place, be.stage as beat_stage,
         rc.clip, rc.shot
    from adult_images i
    left join adult_studio_shoots st on st.id = i.shoot_id
    left join adult_beats be on be.picture_id = i.id
    left join lateral (
      select r.clip, s as shot from adult_reels r cross join lateral jsonb_array_elements(r.shots) s
       where r.owner_id = i.owner_id and s->>'media_id' = i.id limit 1
    ) rc on i.kind = 'video'
   where i.id = any($1::text[])`;
type ContextRow = TagSourceRow & { source_image: string | null };

/** The rows media tags are read from, by id. */
async function contexts(db: Db, ids: string[]): Promise<Map<string, ContextRow>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query<ContextRow & { shot: unknown; clip: unknown }>(CONTEXT_SQL, [ids]);
  return new Map(rows.map((r) => [r.id, { ...r, clip: (r.clip as TagSourceRow["clip"]) ?? null, shot: (r.shot as TagSourceRow["shot"]) ?? null }]));
}

/** Writes tags for a media item, except any the owner removed; a tag already there keeps its source. */
async function writeTags(db: Db, mediaId: string, ownerId: string, tags: readonly MediaTag[]): Promise<void> {
  for (const t of tags) {
    await db.query(
      `insert into adult_media_tags (media_id, owner_id, kind, value, source) values ($1, $2, $3, $4, $5) on conflict (media_id, kind, value) do nothing`,
      [mediaId, ownerId, t.kind, t.value.slice(0, 60), t.source],
    );
  }
}

/**
 * Tags a picture of two (or a first-person one) as it's made (2026-10-26: what it shows is known then, and the framing
 * scores read it, lib/adult/framing.ts): who, the act, whose eyes, and how far it goes. The rest (its place) is read
 * later, as for any picture (ensureTagged).
 */
export async function tagOnCreate(db: Db, mediaId: string, ownerId: string, t: { pair: boolean; act?: string | null; eyes?: "a" | "b" | null; stage?: number | null }): Promise<void> {
  const tags: MediaTag[] = [{ kind: "who", value: t.pair ? "pair" : "solo", source: "choice" }];
  if (t.act && ACT_IDS.has(t.act)) tags.push({ kind: "act", value: t.act, source: "choice" });
  if (t.eyes) tags.push({ kind: "pov", value: t.eyes, source: "choice" });
  if (typeof t.stage === "number") tags.push({ kind: "stage", value: String(levelForStage(t.stage)), source: "choice" });
  await writeTags(db, mediaId, ownerId, tags);
}

/**
 * Tags every untagged ready picture and clip of these characters (the owner's own; anyone's for an admin) from its own record: the back-fill,
 * and new media as it's looked up. A clip's start picture is read first, so the clip shows what it shows. Cheap: SQL
 * and pure code, no model. At most `limit` at a time.
 */
export async function ensureTagged(db: Db, ownerId: string, characters: readonly string[], limit = 200, opts: { anyOwner?: boolean } = {}): Promise<number> {
  const { rows } = await db.query<{ id: string; owner_id: string }>(
    `select id, owner_id from adult_images
      where tagged_at is null and status = 'ready' and kind in ('scene', 'baseline', 'video')
        and (owner_id = $1 or $4::boolean) and (character_id = any($2::text[]) or character_b = any($2::text[]))
      order by created_at desc limit $3`,
    [ownerId, characters, limit, opts.anyOwner === true],
  );
  return tagRows(db, rows);
}

/**
 * Tags these pictures and clips now, as they're made (each ready one not tagged yet; anything else is left alone). Never
 * in the way of what made them: a failure is logged, and the next look (ensureTagged) tags it instead.
 */
export async function tagNow(db: Db, ids: readonly (string | null | undefined)[]): Promise<number> {
  const want = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!want.length) return 0;
  try {
    const { rows } = await db.query<{ id: string; owner_id: string }>(
      `select id, owner_id from adult_images where id = any($1::text[]) and tagged_at is null and status = 'ready' and kind in ('scene', 'baseline', 'video')`,
      [want],
    );
    return await tagRows(db, rows);
  } catch (err) {
    console.log(JSON.stringify({ event: "media_tag_on_create_failed", detail: err instanceof Error ? err.message.slice(0, 200) : "error" }));
    return 0;
  }
}

/** Tags each row from its own record and what it was made from, keeping what it was tagged with when made. */
async function tagRows(db: Db, rows: readonly { id: string; owner_id: string }[]): Promise<number> {
  if (!rows.length) return 0;
  const ctx = await contexts(db, rows.map((r) => r.id));
  // What each was made from: a clip's start picture, or a variation's or upscale's picture (its shoot's `source`).
  const sourceOf = (row: ContextRow | undefined) => row?.source_image ?? (typeof row?.choices?.source === "string" ? row.choices.source : null);
  const sources = await contexts(db, [...new Set(rows.map((r) => sourceOf(ctx.get(r.id))).filter((x): x is string => Boolean(x)))]);
  for (const r of rows) {
    const row = ctx.get(r.id);
    if (!row) continue;
    const from = sourceOf(row);
    const src = from ? sources.get(from) : undefined;
    // What it was tagged with when it was made (tagOnCreate) stands: no second act or view read from its words.
    const made = new Set((await db.query<{ kind: string }>(`select distinct kind from adult_media_tags where media_id = $1 and kind in ('act', 'pov')`, [r.id])).rows.map((x) => x.kind));
    const tags = deriveTags(row, src ? deriveTags(src) : []).filter((t) => !made.has(t.kind));
    await writeTags(db, r.id, r.owner_id, tags);
    await db.query(`update adult_images set tagged_at = now() where id = $1`, [r.id]);
  }
  return rows.length;
}

/** A media item's tags as shown (removed ones left out), or null when it isn't theirs to see. */
export async function mediaTags(db: Db, viewer: string, mediaId: string, opts: { admin?: boolean } = {}): Promise<{ owner_id: string; tags: MediaTag[] } | null> {
  const row = (await db.query<{ owner_id: string; character_id: string | null; character_b: string | null }>(`select owner_id, character_id, character_b from adult_images where id = $1`, [mediaId])).rows[0];
  if (!row || (row.owner_id !== viewer && !opts.admin)) return null;
  await ensureTagged(db, row.owner_id, [row.character_id, row.character_b].filter((x): x is string => Boolean(x)));
  const { rows } = await db.query<MediaTag>(`select kind, value, source from adult_media_tags where media_id = $1 and not removed order by kind, value`, [mediaId]);
  return { owner_id: row.owner_id, tags: rows };
}

/** Is this a tag a person can set: a known kind, and a value that kind takes (a known act or place; a level 0–3). */
export function validTag(kind: string, value: string): kind is TagKind {
  if (!(TAG_KINDS as readonly string[]).includes(kind)) return false;
  if (kind === "act") return ACT_IDS.has(value);
  if (kind === "place") return placeKeySet.has(value);
  if (kind === "who") return value === "solo" || value === "pair";
  if (kind === "stage") return ["0", "1", "2", "3"].includes(value);
  // First person: with the viewer ("yes"), or through one of the two's eyes ("a", "b": lib/adult/acts.ts Eyes).
  if (kind === "pov") return value === "yes" || isEyes(value);
  if (kind === "date") return value === "yes";
  return /^[a-z0-9_]{1,40}$/.test(value);
}

/** The owner sets a tag (manual), or takes one away (kept as removed, so nothing automatic puts it back). */
export async function setTag(db: Db, ownerId: string, mediaId: string, kind: TagKind, value: string, on: boolean): Promise<void> {
  await db.query(
    `insert into adult_media_tags (media_id, owner_id, kind, value, source, removed) values ($1, $2, $3, $4, 'manual', $5)
     on conflict (media_id, kind, value) do update set source = 'manual', removed = excluded.removed, updated_at = now()`,
    [mediaId, ownerId, kind, value, !on],
  );
}

/* ------------------------------------------------- the model's read ------------------------------------------------- */

/**
 * A text model reads the owner's own free words on a few untagged-by-model items (their custom prompt, extras, a clip's
 * guide) for the place and the act, from the fixed lists only: what the record alone can't say ("dark modern cinema" is
 * the movie theater). Run after the response (never in the way of the page), a few at a time; each item is read once.
 */
export async function modelTagPending(db: Db, ownerId: string, characters: readonly string[], limit = 4): Promise<number> {
  const { rows } = await db.query<{ id: string; owner_id: string; choices: Record<string, unknown> | null }>(
    `select i.id, i.owner_id, st.choices from adult_images i join adult_studio_shoots st on st.id = i.shoot_id
      where i.model_tagged_at is null and i.tagged_at is not null and i.status = 'ready' and i.owner_id = $1
        and (i.character_id = any($2::text[]) or i.character_b = any($2::text[]))
      order by i.created_at desc limit $3`,
    [ownerId, characters, limit * 3],
  );
  let read = 0;
  for (const r of rows) {
    if (read >= limit) break;
    const words = ownWords(r.choices);
    await db.query(`update adult_images set model_tagged_at = now() where id = $1`, [r.id]);
    if (!words) continue;
    read++;
    try {
      const raw = await (await adultModel(db)).complete(
        [
          { role: "system", content: "You tag pictures for a private library by reading the words they were made from. Reply with JSON only." },
          {
            role: "user",
            content: [
              `Words: ${words}`,
              `Places (keys): ${PLACES.map((p) => p.key).join(", ")}`,
              `Acts (keys): ${ACTS.map((a) => `${a.id} (${a.label})`).join(", ")}`,
              'Which place and which act do these words describe? Only keys from the lists, or null. Reply {"place": key|null, "act": key|null, "pov": true|false} — pov is true when it is a first-person view with the viewer taking part.',
            ].join("\n"),
          },
        ],
        { temperature: 0, maxTokens: 120 },
      );
      const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { place?: unknown; act?: unknown; pov?: unknown };
      const tags: MediaTag[] = [];
      if (typeof j.place === "string" && placeKeySet.has(j.place)) tags.push({ kind: "place", value: j.place, source: "model" });
      if (typeof j.act === "string" && ACT_IDS.has(j.act)) tags.push({ kind: "act", value: j.act, source: "model" });
      if (j.pov === true) tags.push({ kind: "pov", value: "yes", source: "model" });
      await writeTags(db, r.id, r.owner_id, tags);
    } catch {
      /* a read that fails just leaves the record's own tags */
    }
  }
  return read;
}

/** The model's read after the response, or at once where there's no request (a script, a test). */
export async function modelTagLater(db: Db, ownerId: string, characters: readonly string[]): Promise<void> {
  const run = () => modelTagPending(db, ownerId, characters).catch(() => 0);
  try {
    const { after } = await import("next/server");
    after(run);
  } catch {
    await run();
  }
}

/* ---------------------------------------------------- matching ---------------------------------------------------- */

export type Candidate = { id: string; mime: string; character_id: string | null; character_b: string | null; created_at: string; tags: MediaTag[] };
/** What's happening where a match is wanted: the act, the place's keys, how far it's gone (a STAGES index). */
/** `placed`: the moment names a place at all (whether or not its words are one of PLACES). */
export type MatchWant = { act: string | null; places: readonly string[]; stage: number; placed?: boolean };

/**
 * How well a media item fits a moment: the act most (12), then the place (5), then who's in it (the pair 4, a
 * first-person one of them 3 — the viewer stands in for the partner — one alone 0), pinned for dates (+6, only with the
 * act or place), a clip over a still (+1). Null when it doesn't fit at all: past how far the night has gone, a picture of
 * somewhere else, or neither the act nor the place.
 */
export function scoreMedia(c: Candidate, want: MatchWant): number | null {
  const has = (kind: TagKind, value?: string) => c.tags.some((t) => t.kind === kind && (value === undefined || t.value === value));
  const level = Math.max(-1, ...c.tags.filter((t) => t.kind === "stage").map((t) => Number(t.value)));
  if (level > levelForStage(want.stage)) return null;
  // Somewhere else is never a match, however well the act fits (2026-10-25: a picture from the movie theater at "his
  // apartment entrance"): a picture of a place shows only where they are, and where their place can't be read, only a
  // picture of nowhere in particular can.
  const shown = c.tags.filter((t) => t.kind === "place").map((t) => t.value);
  if (shown.length && (want.places.length ? !want.places.some((p) => shown.includes(p)) : want.placed)) return null;
  const act = Boolean(want.act) && has("act", want.act!);
  const place = want.places.some((p) => has("place", p));
  if (!act && !place) return null;
  let score = (act ? 12 : 0) + (place ? 5 : 0);
  score += c.character_b ? 4 : has("pov") ? 3 : 0;
  if (has("date")) score += 6;
  if (c.mime.startsWith("video/")) score += 1;
  return score;
}

/** The pair's media the viewer can use (theirs, or anyone's for an admin; not 👎'd, not archived), with tags, newest first. */
export async function candidates(db: Db, viewer: string, a: string, b: string, opts: { admin?: boolean; stills?: boolean } = {}): Promise<Candidate[]> {
  const { rows } = await db.query<Omit<Candidate, "tags"> & { tags: MediaTag[] | null; created_at: string | Date }>(
    `select i.id, i.mime, i.character_id, i.character_b, i.created_at,
            (select json_agg(json_build_object('kind', t.kind, 'value', t.value, 'source', t.source)) from adult_media_tags t where t.media_id = i.id and not t.removed) as tags
       from adult_images i
      where i.status = 'ready' and i.kind in ('scene', 'baseline', 'video') and i.tagged_at is not null
        and (i.owner_id = $1 or $4::boolean)
        and (i.character_id in ($2, $3)) and (i.character_b is null or i.character_b in ($2, $3))
        ${opts.stills ? "and i.mime like 'image/%'" : ""}
        and not exists (select 1 from adult_media_thumbs th where th.media_id = i.id and th.owner_id = $1 and th.rating < 0)
        -- a reel shot moved to the Archive is out of every player (lib/adult/reels.ts archiveShot)
        and not exists (select 1 from adult_reels r cross join lateral jsonb_array_elements(r.shots) s
                         where r.owner_id = i.owner_id and s->>'media_id' = i.id and (s->>'archived_at') is not null)
      order by i.created_at desc limit 400`,
    [viewer, a, b, opts.admin === true],
  );
  return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString(), tags: r.tags ?? [] }));
}

/** The best of `list` for `want`, best first (ties: newest), each with its score; those that don't fit left out. */
export function rank(list: readonly Candidate[], want: MatchWant, filter: (c: Candidate) => boolean = () => true): (Candidate & { score: number })[] {
  return list
    .filter(filter)
    .map((c) => ({ ...c, score: scoreMedia(c, want) }))
    .filter((c): c is Candidate & { score: number } => c.score !== null)
    .sort((x, y) => y.score - x.score || y.created_at.localeCompare(x.created_at));
}
