import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { getEpisodeView } from "@/lib/game";
import { clipRefusal, looksLikeJpeg, looksLikeMp4 } from "@/lib/home-clip";
import { ApiError, handle, json, readForm } from "@/lib/http";
import { RECAP_MAX_BYTES, RECAP_MAX_DATES, RECAP_MAX_SECONDS, RECAP_POSTER_MAX_BYTES, saveWeekRecap, weekOfId, weekRecapOn } from "@/lib/week-recap";

export const dynamic = "force-dynamic";

/** The whole form: the video and the poster at their largest, plus the fields and the form's own framing. */
const FORM_MAX_BYTES = RECAP_MAX_BYTES + RECAP_POSTER_MAX_BYTES + 256 * 1024;

/**
 * Owner-only (a signed-in admin account, or the admin key x-frontier-key: lib/admin-auth.ts): a week's recap
 * (lib/week-recap.ts), sent by scripts/clips/weekly-recap.mjs once it is rendered. A multipart form: `week` (its
 * Monday, YYYY-MM-DD), `video` (an MP4), `poster` (a JPEG), `width`, `height`, `seconds`, and `episodes` (the ids of
 * the dates in the cut, in order, separated by commas). The route checks every date itself: aired, public, not hidden,
 * both characters public, fit to feature; one that isn't refuses the whole upload, whatever the caller says. One recap
 * a week: sending a week's again replaces it.
 */
export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  if (!weekRecapOn()) return json({ error: "off", message: "WEEK_RECAP is off." }, 404);
  let form: FormData;
  try {
    form = await readForm(req, FORM_MAX_BYTES);
  } catch (err) {
    if (err instanceof ApiError) throw err; // over FORM_MAX_BYTES: 413
    return json({ error: "invalid_form", message: "Send a multipart form." }, 400);
  }
  const week = weekOfId(String(form.get("week") ?? "").trim());
  if (!week || week.from.getTime() > Date.now()) return json({ error: "invalid_week", message: "week: the week's Monday as YYYY-MM-DD (UTC), not one still to come." }, 400);
  const episodes = [...new Set(String(form.get("episodes") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (!episodes.length || episodes.length > RECAP_MAX_DATES || episodes.some((id) => !/^[\w-]{1,64}$/.test(id))) {
    return json({ error: "invalid_episodes", message: `episodes: the ids of the dates in the cut, 1 to ${RECAP_MAX_DATES}, separated by commas.` }, 400);
  }
  const videoFile = form.get("video");
  const posterFile = form.get("poster");
  if (!(videoFile instanceof Blob) || !(posterFile instanceof Blob)) return json({ error: "missing_files", message: "video (MP4) and poster (JPEG) are both needed." }, 400);
  if (videoFile.size > RECAP_MAX_BYTES || posterFile.size > RECAP_POSTER_MAX_BYTES) {
    return json({ error: "too_large", message: `The video is at most ${RECAP_MAX_BYTES} bytes and the poster ${RECAP_POSTER_MAX_BYTES}.` }, 413);
  }
  const video = Buffer.from(await videoFile.arrayBuffer());
  const poster = Buffer.from(await posterFile.arrayBuffer());
  if (!looksLikeMp4(video) || !looksLikeJpeg(poster)) return json({ error: "invalid_files", message: "video must be an MP4 and poster a JPEG." }, 400);
  const width = Number(form.get("width"));
  const height = Number(form.get("height"));
  const seconds = Number(form.get("seconds"));
  if (!(width >= 120 && width <= 1080 && height >= 120 && height <= 1920 && seconds > 0 && seconds <= RECAP_MAX_SECONDS)) {
    return json({ error: "invalid_size", message: `width, height (up to 1080×1920) and seconds (up to ${RECAP_MAX_SECONDS}) are needed.` }, 400);
  }

  const db = await getDb();
  // Each date as a stranger sees it: a private one is null here, an unaired one isn't revealed.
  for (const id of episodes) {
    const refusal = clipRefusal(await getEpisodeView(db, id, null));
    if (refusal) {
      return json({ error: refusal, episode_id: id, message: `The date ${id} can't be in a recap (${refusal.replace(/_/g, " ")}): only aired public dates between public characters.` }, refusal === "episode_not_found" ? 404 : 409);
    }
  }
  const { id } = await saveWeekRecap(db, { week, video, poster, width, height, seconds: Math.round(seconds * 100) / 100, episodes });
  return json({ ok: true, id, page: `/week/${id}`, video: `/api/week-recap/${id}/recap.mp4`, poster: `/api/week-recap/${id}/poster.jpg`, episodes });
}, { maxBodyBytes: FORM_MAX_BYTES });
