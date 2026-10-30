import { hiveState, mediaPauses } from "@/lib/adult/hive-limit";
import { signedInAdmin } from "@/lib/adult/mode";
import { getAdultSettings, saveAdultSettings } from "@/lib/adult/settings";
import { AdultSettingsInput } from "@/lib/adult/settings-input";
import { getDb } from "@/lib/db";
import { lockedForRequest } from "@/lib/adult/privacy";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";

/** A signed-in admin on a device that isn't locked by their PIN (lib/adult/privacy.ts): their id, else null. */
async function unlockedAdmin(req: Request) {
  const db = await getDb();
  const admin = await signedInAdmin(db, authFromRequest(req));
  return { db, admin: admin && !(await lockedForRequest(db, admin, req)) ? admin : null };
}

/** After dark's settings: a signed-in admin only, even while it's off (that's where it's turned on). */
export const GET = handle(async (req: Request) => {
  const { db, admin } = await unlockedAdmin(req);
  if (!admin) return json({ error: "not_found" }, 404);
  const requests = (await db.query(`select id, agent_id, client_name, reason, created_at from adult_access_requests order by created_at desc limit 50`)).rows;
  // What's paused: Hive over its daily limit (lib/adult/hive-limit.ts), a media provider cooling down (lib/adult/fallback.ts).
  return json({ settings: await getAdultSettings(db), requests, pauses: await mediaPauses(db), hive: await hiveState(db) });
});

export const POST = handle(async (req: Request) => {
  const { db, admin } = await unlockedAdmin(req);
  if (!admin) return json({ error: "not_found" }, 404);
  const input = parseBody(AdultSettingsInput, await readJson(req), "invalid_settings");
  // Who saved it goes in the settings history with each model or provider change. A Studio value that doesn't fit its
  // rules (lib/adult/studio-config.ts) is refused, with what was wrong.
  try {
    return json({ settings: await saveAdultSettings(db, input, admin) });
  } catch (err) {
    if (input.studio !== undefined) return json({ error: "invalid_settings", message: `Studio: ${err instanceof Error ? err.message.slice(0, 300) : "invalid"}` }, 422);
    if (input.writer !== undefined) return json({ error: "invalid_settings", message: `Writer: ${err instanceof Error ? err.message.slice(0, 300) : "invalid"}` }, 422);
    if (input.moderation !== undefined) return json({ error: "invalid_settings", message: `Checks: ${err instanceof Error ? err.message.slice(0, 300) : "invalid"}` }, 422);
    throw err;
  }
});
