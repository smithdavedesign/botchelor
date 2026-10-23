import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { publishShort, setShortPublished, SHORT_TITLE_MAX, shortsPanel } from "@/lib/adult/shorts";
import { isAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

const id = z.string().min(1).max(64);
const Publish = z.object({ a: id, b: id, night_id: id, title: z.string().max(SHORT_TITLE_MAX * 2), cover_id: id.nullable().optional(), video: z.boolean().optional() });
const Toggle = z.object({ id, published: z.boolean() });

/** Not found for everyone but a signed-in admin while After Dark is open to them (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/** The signed-in admin, or null: Shorts are published by an admin only (lib/adult/shorts.ts). */
async function admin(req: Request) {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  return { db, admin: viewer && (await isAdmin(db, viewer)) ? viewer : null };
}

/** The admin's Shorts panel for a pair (?a=&b=): their nights, what each would publish, and the covers to pick from. */
export const GET = handle(async (req: Request) => {
  const { db, admin: who } = await admin(req);
  if (!who) return hidden();
  const q = new URL(req.url).searchParams;
  const panel = await shortsPanel(db, who, q.get("a") ?? "", q.get("b") ?? "");
  return panel ? json({ panel }) : hidden();
});

/** Publish one of their saved nights as a Short (or change a published one's title, cover or video). */
export const POST = handle(async (req: Request) => {
  const { db, admin: who } = await admin(req);
  if (!who) return hidden();
  const input = parseBody(Publish, await readJson(req), "invalid_request");
  const r = await publishShort(db, who, input);
  return r.ok ? json({ short: r.short }, 201) : json({ error: r.error, message: r.message }, r.status);
});

/** Take a Short down (the undo), or put it back up: {id, published}. */
export const PATCH = handle(async (req: Request) => {
  const { db, admin: who } = await admin(req);
  if (!who) return hidden();
  const input = parseBody(Toggle, await readJson(req), "invalid_request");
  const r = await setShortPublished(db, who, input.id, input.published);
  return r.ok ? json({ short: r.short }) : json({ error: r.error, message: r.message }, r.status);
});
