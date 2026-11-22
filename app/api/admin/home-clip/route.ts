import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { airIfDue } from "@/lib/air";
import { getDb } from "@/lib/db";
import { getEpisodeView } from "@/lib/game";
import { clipRefusal, CUT_MAX_BYTES, CUT_MAX_SECONDS, homeHeroClipOn, LOOP_MAX_BYTES, LOOP_MAX_SECONDS, looksLikeJpeg, looksLikeMp4, POSTER_MAX_BYTES, saveHomeClip } from "@/lib/home-clip";
import { ApiError, handle, json, readForm } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The whole form: the loop, the poster and the cut at their largest, plus the fields and the form's own framing. */
const FORM_MAX_BYTES = LOOP_MAX_BYTES + POSTER_MAX_BYTES + CUT_MAX_BYTES + 256 * 1024;

const REFUSALS = {
  episode_not_found: "No such date.",
  not_aired: "That date hasn't aired yet: only an aired date can be the home clip.",
  not_public: "Only a public date between public characters can be the home clip.",
  story_contradicts: "The story check found that date's ending contradicting its lines as written (lib/story-check.ts): it isn't featured.",
} as const;

/**
 * Owner-only (a signed-in admin account, or the admin key x-frontier-key: lib/admin-auth.ts): the day's clip for the home page (lib/home-clip.ts), sent by
 * scripts/clips/daily-clip.mjs once the clip is rendered. A multipart form: `episode` (the date's id), `loop` (a small
 * muted MP4), `poster` (a JPEG of its first frame), `width`, `height`, `seconds`, and optionally `day` (YYYY-MM-DD,
 * else today) and `cut` with `cut_seconds` (the whole clip with its voices, for the episode page's 60-second version;
 * without one the date keeps the cut it has). The route itself checks the date: aired, public, not hidden, both characters public; anything else is
 * refused, whatever the caller says. One clip per date: sending a date's clip again replaces it.
 */
export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  if (!homeHeroClipOn()) return json({ error: "off", message: "HOME_HERO_CLIP is off." }, 404);
  let form: FormData;
  try {
    form = await readForm(req, FORM_MAX_BYTES);
  } catch (err) {
    if (err instanceof ApiError) throw err; // over FORM_MAX_BYTES: 413
    return json({ error: "invalid_form", message: "Send a multipart form." }, 400);
  }
  const episodeId = String(form.get("episode") ?? "").trim();
  if (!/^[\w-]{1,64}$/.test(episodeId)) return json({ error: "invalid_episode", message: "episode: the date's id." }, 400);
  const loopFile = form.get("loop");
  const posterFile = form.get("poster");
  if (!(loopFile instanceof Blob) || !(posterFile instanceof Blob)) return json({ error: "missing_files", message: "loop (MP4) and poster (JPEG) are both needed." }, 400);
  if (loopFile.size > LOOP_MAX_BYTES || posterFile.size > POSTER_MAX_BYTES) {
    return json({ error: "too_large", message: `The loop is at most ${LOOP_MAX_BYTES} bytes and the poster ${POSTER_MAX_BYTES}.` }, 413);
  }
  const loop = Buffer.from(await loopFile.arrayBuffer());
  const poster = Buffer.from(await posterFile.arrayBuffer());
  if (!looksLikeMp4(loop) || !looksLikeJpeg(poster)) return json({ error: "invalid_files", message: "loop must be an MP4 and poster a JPEG." }, 400);
  const width = Number(form.get("width"));
  const height = Number(form.get("height"));
  const seconds = Number(form.get("seconds"));
  if (!(width >= 120 && width <= 1080 && height >= 120 && height <= 1920 && seconds > 0 && seconds <= LOOP_MAX_SECONDS)) {
    return json({ error: "invalid_size", message: `width, height (up to 1080×1920) and seconds (up to ${LOOP_MAX_SECONDS}) are needed.` }, 400);
  }
  // The cut (optional): an MP4 of the whole clip, voices and all.
  const cutFile = form.get("cut");
  let cut: { bytes: Buffer; seconds: number } | null = null;
  if (cutFile instanceof Blob) {
    if (cutFile.size > CUT_MAX_BYTES) return json({ error: "too_large", message: `The cut is at most ${CUT_MAX_BYTES} bytes.` }, 413);
    const bytes = Buffer.from(await cutFile.arrayBuffer());
    const cutSeconds = Number(form.get("cut_seconds"));
    if (!looksLikeMp4(bytes)) return json({ error: "invalid_files", message: "cut must be an MP4." }, 400);
    if (!(cutSeconds > 0 && cutSeconds <= CUT_MAX_SECONDS)) return json({ error: "invalid_size", message: `cut_seconds (up to ${CUT_MAX_SECONDS}) is needed with a cut.` }, 400);
    cut = { bytes, seconds: Math.round(cutSeconds * 100) / 100 };
  }
  const given = String(form.get("day") ?? "").trim();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(given) ? given : new Date().toISOString().slice(0, 10);

  const db = await getDb();
  // As the date's own page does: a date whose window has closed airs when it's opened (lib/air.ts).
  await airIfDue(db, episodeId).catch(() => null);
  // As a stranger sees it: a private date is null here, an unaired one isn't revealed.
  const refusal = clipRefusal(await getEpisodeView(db, episodeId, null));
  if (refusal) return json({ error: refusal, message: REFUSALS[refusal] }, refusal === "episode_not_found" ? 404 : 409);
  const { id } = await saveHomeClip(db, { episode_id: episodeId, day, loop, poster, width, height, seconds, cut });
  return json({ ok: true, id, episode_id: episodeId, day, loop: `/api/home-clip/${id}/loop.mp4`, poster: `/api/home-clip/${id}/poster.jpg`, ...(cut ? { cut: `/api/home-clip/${id}/cut.mp4` } : {}) });
}, { maxBodyBytes: FORM_MAX_BYTES });
