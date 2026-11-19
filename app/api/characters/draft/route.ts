import { z } from "zod";
import { track } from "@/lib/analytics";
import { getDb, type Db } from "@/lib/db";
import {
  draftFromReading,
  expressCreateOn,
  expressFailureLine,
  EXPRESS_PROMPT,
  EXPRESS_TEXT_MAX,
  EXPRESS_TEXT_MIN,
  EXPRESS_TIMEOUT_MS,
  fieldsFromReply,
  screenExpressText,
  type ExpressFailure,
} from "@/lib/express-create";
import { NAME_MAX } from "@/lib/field-limits";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { readyToDate, stillMissing } from "@/lib/import-character";
import { EXPRESS_DRAFT_ALL_LIMITS, EXPRESS_DRAFT_IP_LIMITS, EXPRESS_DRAFT_LIMITS, overLimit, visitorKey } from "@/lib/limits";
import { getModel } from "@/lib/model";
import { nameCheck } from "@/lib/name-check";
import { SPARE_FIRST_NAMES } from "@/lib/names";
import { sheetPgIssue } from "@/lib/safety";

const Body = z.object({
  text: z.string().trim().min(EXPRESS_TEXT_MIN, "Describe them in a sentence or two first.").max(EXPRESS_TEXT_MAX, `At most ${EXPRESS_TEXT_MAX} characters.`),
  name: z.string().trim().max(NAME_MAX).optional(),
});

/** The model's answer, or "timeout" after EXPRESS_TIMEOUT_MS: its own timeout and retries can run to a minute. */
async function ask(text: string): Promise<string | "timeout" | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"timeout">((done) => {
    timer = setTimeout(() => done("timeout"), EXPRESS_TIMEOUT_MS);
  });
  try {
    // The show's FREE model only (allowPaid false), as /import's reader: never the frontier model, whatever FRONTIER_DEFAULT says.
    const call = getModel("low", false).complete(
      [
        { role: "system", content: EXPRESS_PROMPT },
        { role: "user", content: text },
      ],
      { temperature: 0.8, maxTokens: 700 },
    );
    // A call that fails after we stopped waiting must not become an unhandled rejection.
    call.catch(() => {});
    return await Promise.race([call, late]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A name nobody on the show has (names are unique, #734/#737; lib/name-check.ts). The model's own when it's free; else
 * the same surname under one of the show's spare first names (freeNames); else, with no usable name at all, a spare first
 * name picked by the words. Never one the PG screen would drop.
 */
async function freeName(db: Db, wanted: string, seedText: string): Promise<string> {
  if (wanted) {
    const { twin, freeNames } = await nameCheck(db, wanted);
    if (!twin) return wanted;
    const free = (await freeNames()).find((n) => !sheetPgIssue(n));
    if (free) return free;
  }
  const taken = new Set((await db.query<{ name: string }>(`select lower(trim(name)) as name from characters`)).rows.map((r) => r.name));
  const firsts = new Set([...taken].map((n) => n.split(/\s+/)[0]));
  let seed = 0;
  for (const ch of seedText) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = 0; i < SPARE_FIRST_NAMES.length; i++) {
    const given = SPARE_FIRST_NAMES[(seed + i) % SPARE_FIRST_NAMES.length];
    if (!taken.has(given.toLowerCase()) && !firsts.has(given.toLowerCase())) return given;
  }
  return "";
}

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

  const raw = await ask(text);
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
    draft.sheet.name = await freeName(db, draft.sheet.name, text);
    invented.name = Boolean(draft.sheet.name);
  }
  const missing = stillMissing(draft);
  const ready = readyToDate(draft) && !nameTaken;
  track("express_draft", { ok: true, ready, invented_name: invented.name, look: Boolean(draft.extras.looks?.gender) });
  return json({ draft, ready, missing, invented, dropped, ...(nameTaken ? { name_taken: true, free_names: freeNames } : {}) }, 200, sess);
});
