import { z } from "zod";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import {
  draftFromReading,
  expressCreateOn,
  expressFailureLine,
  EXPRESS_TEXT_MAX,
  EXPRESS_TEXT_MIN,
  fieldsFromReply,
  screenExpressText,
  type ExpressFailure,
} from "@/lib/express-create";
import { askExpressModel, freeExpressName } from "@/lib/express-draft";
import { NAME_MAX } from "@/lib/field-limits";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { readyToDate, stillMissing } from "@/lib/import-character";
import { EXPRESS_DRAFT_ALL_LIMITS, EXPRESS_DRAFT_IP_LIMITS, EXPRESS_DRAFT_LIMITS, overLimit, visitorKey } from "@/lib/limits";
import { nameCheck } from "@/lib/name-check";

const Body = z.object({
  text: z.string().trim().min(EXPRESS_TEXT_MIN, "Describe them in a sentence or two first.").max(EXPRESS_TEXT_MAX, `At most ${EXPRESS_TEXT_MAX} characters.`),
  name: z.string().trim().max(NAME_MAX).optional(),
});

/**
 * One-sentence create (lib/express-create.ts): `{ text, name? }` in, a whole builder draft out, written by the show's
 * free model through the import reader's mapping and screen. 200 `{ draft, ready, missing, invented, dropped,
 * name_taken?, free_names? }`. Every refusal carries `reason` and the one sentence the builder shows when it opens its
 * usual form instead: 422 (the words are refused by the show's rules, before any model reads them, or the draft was),
 * 429 (the caps in lib/limits.ts: per visitor, per address, across everyone), 503 (the model is down, slow or answered
 * something unreadable), 404 when EXPRESS_CREATE=0. Nothing is saved: the builder's own steps and POST /api/characters
 * judge the character, and the person still ticks the box.
 */
export const POST = handle(async (req: Request) => {
  const sess = session(req);
  // `past_pg`: refused for going past PG (lib/adult/past-pg.ts), so the builder may offer After Dark instead of a dead end.
  const refuse = (status: number, reason: ExpressFailure, message?: string | null, pastPg = false) => {
    track("express_draft", { ok: false, reason });
    return json({ error: reason, reason, message: expressFailureLine(reason, message), ...(pastPg ? { past_pg: true } : {}) }, status, sess);
  };
  if (!expressCreateOn()) return refuse(404, "off");
  const { text, name = "" } = parseBody(Body, await readJson(req), "invalid_draft");

  // Refused before any model reads it, by the check the bio would meet at the save.
  const screened = screenExpressText(text, name);
  if (!screened.ok) return refuse(422, screened.reason, screened.message, screened.pastPg === true);

  const db = await getDb();
  const visitor = visitorKey(req.headers);
  const limited =
    (await overLimit(db, "express_draft_user", sess.userId, EXPRESS_DRAFT_LIMITS)) ||
    (visitor !== null && (await overLimit(db, "express_draft", visitor, EXPRESS_DRAFT_IP_LIMITS))) ||
    (await overLimit(db, "express_draft_all", "all", EXPRESS_DRAFT_ALL_LIMITS));
  if (limited) return refuse(429, "limited");

  const raw = await askExpressModel(text);
  if (raw === "timeout") return refuse(503, "timeout");
  const reading = raw === null ? null : fieldsFromReply(raw);
  if (!reading) return refuse(503, "model");

  const drafted = draftFromReading(reading, text, name);
  if (!drafted.ok) return refuse(422, drafted.reason, drafted.message);
  const { draft, invented, dropped } = drafted;

  // The name they typed stays theirs: when someone has it, the builder opens on Identity with the free ones to pick.
  // An invented one is swapped for a free one here, so the draft is never stopped by a name they didn't choose.
  let nameTaken = false;
  let freeNames: string[] = [];
  if (name.trim() && draft.sheet.name) {
    const check = await nameCheck(db, draft.sheet.name);
    if (check.twin) {
      nameTaken = true;
      freeNames = await check.freeNames();
    }
  } else {
    draft.sheet.name = await freeExpressName(db, draft.sheet.name, text);
    invented.name = Boolean(draft.sheet.name);
  }
  const missing = stillMissing(draft);
  const ready = readyToDate(draft) && !nameTaken;
  track("express_draft", { ok: true, ready, invented_name: invented.name, look: Boolean(draft.extras.looks?.gender) });
  return json({ draft, ready, missing, invented, dropped, ...(nameTaken ? { name_taken: true, free_names: freeNames } : {}) }, 200, sess);
});
