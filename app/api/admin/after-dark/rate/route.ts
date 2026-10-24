import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { rateMedia } from "@/lib/adult/steering";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { shotsFollowRating } from "@/lib/adult/reels";

const id = z.string().min(1).max(64);
/** 👍 (1), 👎 (-1) with what was off (lib/adult/rating-tags.ts), or 0 to take a rating back. */
const Input = z.object({ media_id: id, rating: z.union([z.literal(-1), z.literal(0), z.literal(1)]), tags: z.array(z.string().max(40)).max(12).optional() });

/** Not found for everyone but a viewer after dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/**
 * Rate one of your pictures or videos (lib/adult/steering.ts): what you say steers your own next pictures and videos of
 * the same character, and nobody else's. Never a dataset.
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const r = await rateMedia(db, viewer, input.media_id, input.rating, input.tags ?? []);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
  // A 👎 on a shot takes it out of its video of the night; taking it back puts it back (lib/adult/reels.ts).
  const reels_changed = await shotsFollowRating(db, viewer, input.media_id, input.rating).catch(() => 0);
  return json({ rating: r.rating, tags: r.tags, ...(reels_changed ? { reels_changed } : {}) });
});
