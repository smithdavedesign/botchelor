import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { fixVideo, keepVideo, videoFixState } from "@/lib/adult/video-fix";
import { VIDEO_PROBLEM_IDS } from "@/lib/adult/video-fix-shared";
import { CUSTOM_MAX } from "@/lib/adult/studio-catalog";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";

const id = z.string().min(1).max(64);
/**
 * 🩹 Fix one of the owner's Studio animations (lib/adult/video-fix.ts): what was wrong (the chips) and, if they like,
 * new words for what happens, filmed again from where it started; or keep one of its versions, the one the galleries show.
 */
const Input = z.union([
  z.object({ action: z.literal("keep"), media_id: id }),
  z.object({
    action: z.literal("fix").optional(),
    media_id: id,
    problems: z.array(z.enum(VIDEO_PROBLEM_IDS as [string, ...string[]])).max(VIDEO_PROBLEM_IDS.length).optional(),
    // Longer than the cap is cut there (cleanCustom), not refused; null or left out keeps the words it was made with.
    words: z.string().max(CUSTOM_MAX * 4).nullable().optional(),
  }),
]);

/** Not found for everyone but a viewer After Dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/** The Fix sheet's state for an animation: its versions, the fixes left, what one costs, and the picture it began with. */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const mediaId = new URL(req.url).searchParams.get("media_id") ?? "";
  if (!mediaId || mediaId.length > 64) return json({ error: "invalid_request", message: "Which video?" }, 422);
  const r = await videoFixState(db, viewer, mediaId);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
  return json({ state: r.state });
});

export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice.
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (input.action === "keep") {
    const r = await keepVideo(db, viewer, input.media_id);
    if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
    return json({ kept: r.kept, hidden: r.hidden, state: r.state });
  }
  const r = await fixVideo(db, viewer, input.media_id, { problems: input.problems, words: input.words }, requestBase(req));
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
  const state = await videoFixState(db, viewer, input.media_id);
  return json({ shoot: r.shoot, message: r.message, state: state.ok ? state.state : null });
});
