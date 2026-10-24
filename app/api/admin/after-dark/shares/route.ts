import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { answerShare, removeShare, setAutoAccept, sharedWithMe } from "@/lib/adult/shares";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

const id = z.string().min(1).max(64);
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("answer"), share_id: id, accept: z.boolean() }),
  z.object({ action: z.literal("remove"), share_id: id }),
  z.object({ action: z.literal("auto_accept"), on: z.boolean() }),
]);

/** Not found for everyone After Dark isn't open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/** What's been shared with the viewer in After Dark (lib/adult/shares.ts): requests, and the pictures they accepted. */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice.
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  return json(await sharedWithMe(db, viewer));
});

/** Accept or decline a request, remove a picture shared with them, or take shares without being asked. */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice.
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (input.action === "auto_accept") await setAutoAccept(db, viewer, input.on);
  else {
    const ok = input.action === "answer" ? await answerShare(db, viewer, input.share_id, input.accept) : await removeShare(db, viewer, input.share_id);
    if (!ok) return json({ error: "not_found", message: "That share isn't waiting for you any more." }, 404);
  }
  return json(await sharedWithMe(db, viewer));
});
