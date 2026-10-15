import { approvedAssetWithOwner } from "@/lib/assets";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { fetchVideoContent } from "@/lib/image";
import { userImageKey } from "@/lib/keys";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Streams an APPROVED clip's MP4. The bytes stay with the provider: we fetch them on the clip owner's own
 * stored key (their content, their key) and proxy them to the viewer. If the owner removed their key, or the
 * provider has expired the content, playback 404s — the durable poster (served by /api/assets/[id]) remains.
 */
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const found = await approvedAssetWithOwner(db, id);
  if (!found || found.asset.kind !== "clip" || !found.asset.source_url || !found.owner_id) {
    return json({ error: "clip_not_found" }, 404);
  }
  const key = await userImageKey(db, found.owner_id);
  if (!key) return json({ error: "clip_unavailable", message: "This clip's owner has removed their key." }, 404);

  let upstream: Response;
  try {
    upstream = await fetchVideoContent(key.apiKey, found.asset.source_url);
  } catch {
    return json({ error: "clip_unavailable" }, 404);
  }
  if (!upstream.ok || !upstream.body) return json({ error: "clip_unavailable" }, 404);
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "video/mp4",
      "cache-control": "public, max-age=86400",
    },
  });
});
