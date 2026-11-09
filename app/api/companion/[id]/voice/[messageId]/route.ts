import { AI_HEADERS } from "@/lib/ai-mark";
import { getDb } from "@/lib/db";
import { session } from "@/lib/http";
import { objectStore } from "@/lib/object-store";
import { voiceBytes, voiceFile, voiceLinkValid } from "@/lib/companion-voice";
import { companionRefusal } from "../../../access";

type Ctx = { params: Promise<{ id: string; messageId: string }> };

/** A ready voice file's bytes never change (it's kept by its words' hash), so its owner's browser may keep it. */
const KEEP = "private, max-age=31536000, immutable";

/**
 * A companion reply's voice note (lib/companion-voice.ts): to the thread's owner, signed in (or by the short-lived signed
 * link an agent is handed over MCP). Never cached anywhere shared. A file in the bucket is a redirect to a short-lived
 * presigned link, the same one all through its window, so the browser's copy is reused.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id, messageId } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const linked = voiceLinkValid(id, messageId, q.get("until"), q.get("sig"));
  const db = await getDb();
  let owner: string | null = null;
  if (!linked) {
    const sess = session(req);
    if (!sess.authenticated) return new Response("Not found", { status: 404 });
    const refused = await companionRefusal(db, req, sess);
    if (refused) return new Response("Not found", { status: 404 });
    owner = sess.userId;
  }
  const file = await voiceFile(db, id, messageId, owner);
  if (!file) return new Response("Not found", { status: 404 });
  const store = file.object_key ? objectStore() : null;
  if (store && file.object_key) {
    const link = await store.presign(file.object_key).catch(() => null);
    if (link) {
      return new Response(null, {
        status: 302,
        headers: { location: link.url, "cache-control": `private, max-age=${link.maxAge}`, "referrer-policy": "no-referrer", "x-robots-tag": "noindex" },
      });
    }
  }
  const bytes = await voiceBytes(file);
  if (!bytes) return new Response("Not found", { status: 404 });
  // Made by a model: marked AI-generated in its headers (lib/ai-mark.ts), as every voice is.
  return new Response(new Uint8Array(bytes), { headers: { "content-type": file.mime, "cache-control": KEEP, "x-robots-tag": "noindex", ...AI_HEADERS } });
}
