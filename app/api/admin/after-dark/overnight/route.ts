import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { startOvernightNight } from "@/lib/adult/overnight";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

const Input = z.object({ episode_id: z.string().trim().min(1).max(64) });

/** Not found for everyone After Dark isn't open to (lib/adult/mode.ts adultViewer), as on every After Dark route. */
const hidden = () => json({ error: "not_found" }, 404);

/**
 * "Continue the night" (lib/adult/overnight.ts): starts the pair's night from their overnight date and answers where it
 * is. The same not-found for a date this viewer can't continue as for a stranger. Nothing is written or charged here:
 * the night's own page asks for the first chapter, as for any night.
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const started = await startOvernightNight(db, viewer, input.episode_id);
  return started ? json({ path: started.path }) : hidden();
});
