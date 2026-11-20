import { afterDarkOnly } from "@/lib/after-dark-host";
import { CLIP_MAX_BYTES, CLIP_MAX_SECONDS, CLIP_POSTER_MAX_BYTES, clipWorkerAuthorized, finishClip, looksLikeJpeg, looksLikeMp4, looksLikePng } from "@/lib/clip-requests";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * The Mac's finished clip (lib/clip-requests.ts finishClip): a multipart form with `id`, `attempt` (the one the claim
 * gave), `clip` (the MP4), `seconds`, and optionally `poster` (the cover, PNG or JPEG). Kept in the media store, the
 * request marked ready and its owner notified. Needs `Authorization: Bearer $CLIP_WORKER_SECRET` (else 404).
 */
export const POST = handle(async (req: Request) => {
  if (afterDarkOnly() || !clipWorkerAuthorized(req)) return json({ error: "not_found" }, 404);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "invalid_form", message: "Send a multipart form." }, 400);
  }
  const id = String(form.get("id") ?? "");
  const attempt = Number(form.get("attempt"));
  if (!/^[\w-]{1,64}$/.test(id) || !Number.isInteger(attempt) || attempt < 1) return json({ error: "invalid_request", message: "id and attempt, as the claim gave them." }, 400);
  const clipFile = form.get("clip");
  if (!(clipFile instanceof Blob)) return json({ error: "missing_files", message: "clip (MP4) is needed." }, 400);
  if (clipFile.size > CLIP_MAX_BYTES) return json({ error: "too_large", message: `The clip is at most ${CLIP_MAX_BYTES} bytes.` }, 413);
  const clip = Buffer.from(await clipFile.arrayBuffer());
  if (!looksLikeMp4(clip)) return json({ error: "invalid_files", message: "clip must be an MP4." }, 400);
  const seconds = Number(form.get("seconds"));
  if (!(seconds > 0 && seconds <= CLIP_MAX_SECONDS)) return json({ error: "invalid_size", message: `seconds (up to ${CLIP_MAX_SECONDS}) is needed.` }, 400);
  const posterFile = form.get("poster");
  let poster: { bytes: Buffer; mime: "image/png" | "image/jpeg" } | null = null;
  if (posterFile instanceof Blob) {
    if (posterFile.size > CLIP_POSTER_MAX_BYTES) return json({ error: "too_large", message: `The poster is at most ${CLIP_POSTER_MAX_BYTES} bytes.` }, 413);
    const bytes = Buffer.from(await posterFile.arrayBuffer());
    const mime = looksLikePng(bytes) ? "image/png" : looksLikeJpeg(bytes) ? "image/jpeg" : null;
    if (!mime) return json({ error: "invalid_files", message: "poster must be a PNG or a JPEG." }, 400);
    poster = { bytes, mime };
  }
  const done = await finishClip(await getDb(), { id, attempt, clip, seconds, poster });
  if (!done.ok) return json({ error: done.error }, done.error === "not_found" ? 404 : 409);
  return json({ ok: true, clip: done.clip });
});
