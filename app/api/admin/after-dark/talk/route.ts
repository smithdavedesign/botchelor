import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { eligiblePair } from "@/lib/adult/scenes";
import { collectTalks, makeTalk, talkPrice, talksFor } from "@/lib/adult/talks";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";

export const dynamic = "force-dynamic";
// The line's voice may be made first (a few seconds), then the clip is queued.
export const maxDuration = 60;

/** Not found for everyone After Dark isn't open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/**
 * Talking moments (lib/adult/talks.ts): `GET ?a&b` gives the pair's (collecting any that are done first) and the price;
 * `POST { a, b, i, text, night_id? }` makes the one for that line, or gives the one already made of those words.
 */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const q = new URL(req.url).searchParams;
  const pair = await eligiblePair(db, viewer, q.get("a") ?? "", q.get("b") ?? "");
  if (!pair) return hidden();
  await collectTalks(db, viewer).catch(() => 0);
  return json({ talks: await talksFor(db, viewer, pair), price: await talkPrice(db, viewer) });
});

const Input = z.object({
  a: z.string().min(1).max(120),
  b: z.string().min(1).max(120),
  i: z.number().int().min(0).max(5000),
  text: z.string().min(1).max(4000),
  night_id: z.string().max(120).nullish(),
});

export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const input = parseBody(Input, await readJson(req), "invalid_talk");
  const made = await makeTalk(db, viewer, input, requestBase(req));
  if (!made.ok) return json({ error: made.error, message: made.message }, made.status);
  return json({ talk: made.talk, price: made.price }, made.talk.status === "making" ? 202 : 200);
});
