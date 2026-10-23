import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { keptSidesForNight, keptSidesForShort, sidesForNight, sidesForShort, sidesPanel } from "@/lib/adult/monologues";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

// Writing both pages and both texts is one model call of a couple of thousand tokens.
export const maxDuration = 300;

const id = z.string().min(1).max(64);
const Input = z.union([z.object({ night_id: id }), z.object({ short_id: id })]);

const hidden = () => json({ error: "not_found" }, 404);

/** The viewer, or null for anyone After Dark isn't open to, and every bot. */
async function viewer(req: Request) {
  if (detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent"))) return null;
  const db = await getDb();
  const who = await adultViewer(db, req);
  return who ? { db, who } : null;
}

/**
 * Two sides of the night (lib/adult/monologues.ts), read only: ?a=&b= the owner's nights of a pair (which have them, and
 * how many they can still write this month); ?night_id= or ?short_id= the kept two sides, or null.
 */
export const GET = handle(async (req: Request) => {
  const v = await viewer(req);
  if (!v) return hidden();
  const q = new URL(req.url).searchParams;
  const night = q.get("night_id");
  const short = q.get("short_id");
  if (night) return json({ sides: await keptSidesForNight(v.db, v.who, night) });
  if (short) return json({ sides: await keptSidesForShort(v.db, v.who, short) });
  const panel = await sidesPanel(v.db, v.who, q.get("a") ?? "", q.get("b") ?? "");
  return panel ? json({ panel }) : hidden();
});

/** Both sides of one of the owner's whole nights ({night_id}), or of a Short they've pressed play on ({short_id}): kept, or written now. */
export const POST = handle(async (req: Request) => {
  const v = await viewer(req);
  if (!v) return hidden();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const r = "night_id" in input ? await sidesForNight(v.db, v.who, input.night_id) : await sidesForShort(v.db, v.who, input.short_id);
  return r.ok ? json({ sides: r.sides, written: r.written }) : json({ error: r.error, message: r.message }, r.status);
});
