import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { clearNotifications, listNotifications, markRead, unreadCount } from "@/lib/notifications";

/** Your notifications, newest first, and how many are unread (lib/notifications.ts). */
export const GET = handle(async (req: Request) => {
  const sess = session(req);
  const db = await getDb();
  const [items, unread] = await Promise.all([listNotifications(db, sess.userId), unreadCount(db, sess.userId)]);
  return json({ unread, notifications: items }, 200, sess);
});

const MarkInput = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(100) })]);

/** Marks some, or all, of your notifications read. */
export const POST = handle(async (req: Request) => {
  const sess = session(req);
  const input = parseBody(MarkInput, await readJson(req), "invalid_request");
  const marked = await markRead(await getDb(), sess.userId, "all" in input ? "all" : input.ids);
  return json({ marked }, 200, sess);
});

/** Clears some, or all, of your notifications: { "all": true } or { "ids": [...] }. */
export const DELETE = handle(async (req: Request) => {
  const sess = session(req);
  const input = parseBody(MarkInput, await readJson(req), "invalid_request");
  const db = await getDb();
  const cleared = await clearNotifications(db, sess.userId, "all" in input ? "all" : input.ids);
  return json({ cleared, unread: await unreadCount(db, sess.userId) }, 200, sess);
});
