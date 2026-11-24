/**
 * 🩹 Fix for a Studio animation (lib/adult/video-fix-shared.ts says why and what a fix tells the model). The video is
 * filmed again from the very start it had: an animation of a picture from that picture (as it's kept now, so a picture
 * mended with 🩹 Fix first is the one it starts from), a link kept going from the frame it started from
 * (lib/adult/studio-keep-going.ts refilmLink). Held to everything making it was (animatePicture and planLink run again,
 * with the words it's given now).
 *
 *  - **Versions:** each fix is a new video (`fixed_from` the version it was made from, `fix_root` the original), at most
 *    VIDEO_FIXES_MAX for an original; Keep makes one the version the galleries show (`superseded_by`), as a fixed
 *    picture's Keep does (lib/adult/fix.ts).
 *  - **Price:** the first fix of a video marked broken (a chip picked) is free, once, while the Studio's free redo is on
 *    (studio.free_redo, the same switch as a shoot's); any other costs Animate's price for its length. A free one that
 *    doesn't come through is free again. The free one replaces a broken clip, so it isn't one of the month's clips
 *    (lib/adult/usage.ts): neither refused at the cap nor counted. Once a video, it costs us at most one more Venice
 *    video for each one sold.
 */
import type { Db } from "../db";
import { animatePicture, studioAccess, type JobResult, type StudioFail } from "./studio";
import { ANIMATE_MOTIONS, cleanCustom, CUSTOM_MAX } from "./studio-catalog";
import type { CameraMoveId } from "./camera-moves";
import { NEXT_WORDS_MAX } from "./clip-chains";
import { refilmLink } from "./studio-keep-going";
import {
  cleanProblems,
  fixNote,
  VIDEO_FIXES_MAX,
  videoProblemChips,
  type VideoFixMark,
  type VideoFixState,
} from "./video-fix-shared";

const fail = (status: number, error: string, message: string): StudioFail => ({ ok: false, status, error, message });

/** What an animate shoot was made with, as far as a fix reads it (animatePicture's choices, and a link's). */
type Made = {
  source?: string;
  motion?: string | null;
  seconds?: number;
  camera?: CameraMoveId;
  guide?: string;
  dialog?: string;
  transcript?: string;
  level?: number;
  from?: string;
  cut?: { video: string; frame: string; at: number; seamless: boolean };
  facts?: { people: [string, string | null]; place: string | null; aspect: string | null; pov: string | null };
};

/** One of the viewer's own ready Studio animations, with the shoot that made it. */
async function animationOf(db: Db, viewer: string, videoId: string): Promise<{ id: string; character_id: string; fix_root: string | null; made: Made } | null> {
  const r = (
    await db.query<{ id: string; character_id: string; fix_root: string | null; choices: Made | null }>(
      `select v.id, v.character_id, v.fix_root, s.choices
         from adult_images v join adult_studio_shoots s on s.id = v.shoot_id and s.kind = 'animate' and s.owner_id = $2
        where v.id = $1 and v.owner_id = $2 and v.kind = 'video' and v.status = 'ready'`,
      [videoId, viewer],
    )
  ).rows[0];
  return r ? { id: r.id, character_id: r.character_id, fix_root: r.fix_root, made: r.choices ?? {} } : null;
}

type VersionRow = { id: string; fix_note: string | null; superseded_by: string | null; created_at: Date | string };
/** Every ready version of an original video, the original first, then oldest to newest. */
async function versionRows(db: Db, viewer: string, root: string): Promise<VersionRow[]> {
  return (
    await db.query<VersionRow>(
      `select id, fix_note, superseded_by, created_at from adult_images
        where owner_id = $2 and status = 'ready' and kind = 'video' and (id = $1 or fix_root = $1)
        order by (id = $1) desc, created_at, id`,
      [root, viewer],
    )
  ).rows;
}

/** The original's fixes so far (being made or made), whether one's being made now, and whether the free one is spent. */
async function tally(db: Db, viewer: string, root: string): Promise<{ used: number; making: boolean; freeUsed: boolean }> {
  const r = (
    await db.query<{ used: number; making: boolean | null; free_used: boolean | null }>(
      `select count(*)::int as used, bool_or(status = 'making') as making, bool_or((choices->'fix'->>'free')::boolean) as free_used
         from adult_studio_shoots
        where owner_id = $1 and kind = 'animate' and status in ('making', 'ready') and choices->'fix'->>'root' = $2`,
      [viewer, root],
    )
  ).rows[0];
  return { used: r?.used ?? 0, making: r?.making === true, freeUsed: r?.free_used === true };
}

/** How long its words can be: a link's (lib/adult/clip-chains.ts) or Animate's. */
const wordsMax = (made: Made): number => (made.cut ? NEXT_WORDS_MAX : CUSTOM_MAX);

/** A picture as it's kept now: the version 🩹 Fix's Keep put in its place, or itself. */
async function keptPicture(db: Db, pictureId: string): Promise<string | null> {
  return (await db.query<{ id: string }>(`select coalesce(superseded_by, id) as id from adult_images where id = $1`, [pictureId])).rows[0]?.id ?? null;
}

/** Everything the Fix sheet shows for an animation: its versions, the fixes left, what one costs, and where it began. */
export async function videoFixState(db: Db, viewer: string, videoId: string): Promise<{ ok: true; state: VideoFixState } | StudioFail> {
  const v = await animationOf(db, viewer, videoId);
  if (!v) return fail(404, "not_found", "There's no Studio animation of yours with that id.");
  const access = await studioAccess(db, viewer, v.character_id);
  if (!access.ok) return access;
  const root = v.fix_root ?? v.id;
  const [rows, t] = await Promise.all([versionRows(db, viewer, root), tally(db, viewer, root)]);
  const seconds = v.made.seconds === 10 ? 10 : 5;
  // The picture it was animated from, when it's one of their pictures 🩹 Fix can mend (a link starts from a frame: none).
  const kept = !v.made.cut && v.made.source ? await keptPicture(db, v.made.source) : null;
  const start = kept
    ? ((await db.query<{ id: string }>(`select id from adult_images where id = $1 and owner_id = $2 and kind = 'scene' and status = 'ready' and mime like 'image/%'`, [kept, viewer])).rows[0]?.id ?? null)
    : null;
  return {
    ok: true,
    state: {
      root,
      versions: rows.map((r) => ({ id: r.id, note: r.id === root ? null : r.fix_note, shown: !r.superseded_by, created_at: new Date(r.created_at).toISOString() })),
      left: Math.max(0, VIDEO_FIXES_MAX - t.used),
      making: t.making,
      free: access.config.free_redo && !t.freeUsed,
      price: access.admin ? 0 : seconds === 10 ? access.config.prices.animate_10 : access.config.prices.animate_5,
      seconds,
      words: cleanCustom(v.made.guide, wordsMax(v.made)) ?? "",
      motion: v.made.motion ? (ANIMATE_MOTIONS.find((m) => m.id === v.made.motion)?.label ?? null) : null,
      start,
      problems: videoProblemChips(),
      words_max: wordsMax(v.made),
      kept: rows.find((r) => r.superseded_by)?.superseded_by ?? null,
    },
  };
}

/**
 * Fix one of their Studio animations: what was wrong (the chips) and, if they like, new words for what happens. Filmed
 * again from where it started; collected as the page polls (collectAnimations), as a new version of it.
 */
export async function fixVideo(db: Db, viewer: string, videoId: string, ask: { problems?: readonly string[]; words?: string | null }, baseUrl: string): Promise<JobResult> {
  const v = await animationOf(db, viewer, videoId);
  if (!v) return fail(404, "not_found", "There's no Studio animation of yours with that id.");
  const access = await studioAccess(db, viewer, v.character_id);
  if (!access.ok) return access;
  const root = v.fix_root ?? v.id;
  const t = await tally(db, viewer, root);
  if (t.making) return fail(409, "busy", "A fix of it is being made: it lands in the gallery in a few minutes.");
  if (t.used >= VIDEO_FIXES_MAX) return fail(409, "no_fixes_left", `That video has had its ${VIDEO_FIXES_MAX} fixes. Animate the picture again for a new one.`);
  const problems = cleanProblems(ask.problems);
  // What happens in it: their words now, or as it was asked when they leave them as they were.
  const max = wordsMax(v.made);
  const was = cleanCustom(v.made.guide, max) ?? "";
  const given = ask.words === undefined || ask.words === null ? undefined : (cleanCustom(ask.words, max) ?? "");
  const words = given === undefined ? was || undefined : given || undefined;
  const changed = (words ?? "") !== was;
  if (!problems.length && !changed) return fail(422, "nothing_to_fix", "Say what's wrong with it: pick what's off, or change what should happen.");
  const fix: VideoFixMark = { root, from: v.id, problems, note: fixNote(problems, changed ? words : null), free: problems.length > 0 && access.config.free_redo && !t.freeUsed };
  if (v.made.cut) return refilmLink(db, viewer, v.character_id, v.made, { words, fix }, baseUrl);
  const source = v.made.source ? await keptPicture(db, v.made.source) : null;
  if (!source) return fail(404, "not_found", "The picture it was animated from isn't there any more. Animate another one instead.");
  return animatePicture(
    db,
    viewer,
    v.character_id,
    { image_id: source, motion: v.made.motion ?? undefined, seconds: v.made.seconds ?? 5, camera: v.made.camera ?? null, guide: words, dialog: v.made.dialog, transcript: v.made.transcript },
    baseUrl,
    { fix },
  );
}

/** Keep one version: the one the galleries show; the others leave them (still in the Fix sheet). Keeping the original puts it back. */
export async function keepVideo(db: Db, viewer: string, videoId: string): Promise<{ ok: true; kept: string; hidden: string[]; state: VideoFixState } | StudioFail> {
  const v = await animationOf(db, viewer, videoId);
  if (!v) return fail(404, "not_found", "There's no Studio animation of yours with that id.");
  const ids = (await versionRows(db, viewer, v.fix_root ?? v.id)).map((r) => r.id);
  await db.query(`update adult_images set superseded_by = case when id = $1 then null else $1 end where owner_id = $2 and id = any($3)`, [v.id, viewer, ids]);
  const state = await videoFixState(db, viewer, v.id);
  if (!state.ok) return state;
  return { ok: true, kept: v.id, hidden: ids.filter((x) => x !== v.id), state: state.state };
}
