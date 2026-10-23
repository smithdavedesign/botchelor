import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { withOrigins } from "@/lib/origin";
import { DECK_PAGE, deckFor, logImpressions, scheduleMatchChat, swipe, undoLike } from "@/lib/swipes";

/**
 * The swipe deck (lib/swipes.ts, docs/swipes.md): `GET ?character_id=` deals the next cards for one of your characters;
 * `POST` swipes one. A like both ways (or on a house character) is a match, and its opening chat runs after the reply.
 */
export const GET = handle(async (req: Request) => {
  const sess = session(req);
  const params = new URL(req.url).searchParams;
  const limit = Number(params.get("limit") ?? DECK_PAGE);
  const db = await getDb();
  const r = await deckFor(db, sess.userId, params.get("character_id")?.slice(0, 64) ?? "", Number.isFinite(limit) ? limit : DECK_PAGE);
  if (!r.ok) return json({ error: r.error, message: r.message, ...(r.missing ? { missing: r.missing } : {}) }, r.status, sess);
  // A Next.js prefetch isn't a person looking at the deck: only real serves are logged.
  if (!req.headers.get("next-router-prefetch")) await logImpressions(db, r.for.id, r.cards, r.scores, "web");
  return json({ for: r.for, cards: await withOrigins(db, r.cards) }, 200, sess);
});

const Input = z.object({ character_id: z.string().min(1).max(64), target_id: z.string().min(1).max(64), like: z.boolean() });

export const POST = handle(async (req: Request) => {
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  const r = await swipe(db, sess.userId, input.character_id, input.target_id, input.like);
  if (!r.ok) return json({ error: r.error, message: r.message, ...(r.missing ? { missing: r.missing } : {}) }, r.status, sess);
  if (r.match) await scheduleMatchChat(db, r.match.lo, r.match.hi);
  return json({ liked: r.liked, match: r.match }, 200, sess);
});

const UndoInput = z.object({ character_id: z.string().min(1).max(64), target_id: z.string().min(1).max(64) });

/**
 * Takes back one of your likes (#622): only while it's unanswered, within 10 minutes (lib/swipes.ts undoLike says why that
 * reveals nothing). The card comes back to the deck; a pass, or a like that matched, stays.
 */
export const DELETE = handle(async (req: Request) => {
  const sess = session(req);
  const input = parseBody(UndoInput, await readJson(req), "invalid_request");
  const db = await getDb();
  const r = await undoLike(db, sess.userId, input.character_id, input.target_id);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status, sess);
  return json({ undone: r.undone }, 200, sess);
});
