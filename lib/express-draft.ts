/**
 * The server half of one-sentence create (lib/express-create.ts is the pure, client-safe half): the model call and the
 * free name. Shared by the builder's route (app/api/characters/draft) and the Discord /date bot (lib/discord-bot.ts), so
 * both draft with the same prompt, the same free model, the same wait and the same name rule.
 */
import type { Db } from "./db";
import { EXPRESS_PROMPT, EXPRESS_TIMEOUT_MS } from "./express-create";
import { getModel } from "./model";
import { nameCheck } from "./name-check";
import { SPARE_FIRST_NAMES } from "./names";
import { sheetPgIssue } from "./safety";

/** The model's answer, or "timeout" after EXPRESS_TIMEOUT_MS: its own timeout and retries can run to a minute. */
export async function askExpressModel(text: string): Promise<string | "timeout" | null> {
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
export async function freeExpressName(db: Db, wanted: string, seedText: string): Promise<string> {
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
