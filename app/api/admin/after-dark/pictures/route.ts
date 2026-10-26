import { z } from "zod";
import { FRAMINGS } from "@/lib/adult/acts";
import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { makeMenuPicture, pictureMenu } from "@/lib/adult/pictures-menu";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";

// One keyframe of the two of them and its check: 10 to 30 seconds, a baseline made first can add as much again.
export const maxDuration = 120;

const id = z.string().min(1).max(64);
/** The choices: the act (who leads swapped, or not), what they wear, the framing (or whose eyes), and one of the night's places. */
const Input = z.object({
  a: id,
  b: id,
  act: z.string().min(1).max(40),
  swap: z.boolean().optional(),
  outfit: z.string().min(1).max(40),
  framing: z.enum(FRAMINGS),
  place: z.string().min(1).max(200),
  // Seen through one of their eyes (the act's first-person view): whose, in the pair's order.
  eyes: z.enum(["a", "b"]).nullable().optional(),
});

/** Not found for everyone but a viewer after dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/** The pair's picture menu (?a=&b=): the price, what's left this month, and the acts, outfits, framings and places. */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice.
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const q = new URL(req.url).searchParams;
  const menu = await pictureMenu(db, viewer, q.get("a") ?? "", q.get("b") ?? "");
  return menu ? json(menu) : hidden();
});

/** Make a picture of both of them from the menu (lib/adult/pictures-menu.ts): checked, then kept in their gallery. */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice.
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const r = await makeMenuPicture(db, viewer, input.a, input.b, input, requestBase(req));
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
  return json({ picture: r.picture });
});
