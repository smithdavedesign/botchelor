import { z } from "zod";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { LETTER_MAX, listLetters, markLettersRead, penPals, sendLetter } from "@/lib/letters";

/** GET: this person's letters (?box=in|out|all), or with ?pals=<character id>, who that character can write to. */
export const GET = handle(async (req) => {
  const sess = session(req);
  const db = await getDb();
  const url = new URL(req.url);
  const pals = url.searchParams.get("pals");
  if (pals) return json({ pals: await penPals(db, sess.userId, pals) }, 200, sess);
  const box = url.searchParams.get("box");
  return json(await listLetters(db, sess.userId, { box: box === "in" || box === "out" ? box : "all" }), 200, sess);
});

const Send = z.object({
  from_character: z.string().min(1).max(80),
  to_character: z.string().min(1).max(80),
  body: z.string().max(LETTER_MAX + 500),
  reply_to: z.string().max(40).nullable().optional(),
});

/** POST: send a letter from one of your characters. It arrives hours later. */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(Send, await readJson(req), "invalid_letter");
  const r = await sendLetter(await getDb(), sess.userId, input);
  if (!r.ok) return json({ error: r.code, message: r.error }, r.code === "not_your_character" ? 403 : 400, sess);
  track("letter_sent", { reply: Boolean(r.letter.reply_to) });
  return json(r.letter, 201, sess);
});

const Read = z.object({ ids: z.array(z.string().max(40)).max(100).nullable().optional() });

/** PATCH: mark arrived letters read (these ids, or all). */
export const PATCH = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(Read, await readJson(req), "invalid_request");
  return json({ marked: await markLettersRead(await getDb(), sess.userId, input.ids ?? null) }, 200, sess);
});
