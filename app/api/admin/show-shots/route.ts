import { z } from "zod";
import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { inBackground } from "@/lib/sets";
import { drawShowShots, shotsFor } from "@/lib/show-shots";
import { SHOTS } from "@/lib/show-shots-shared";
import { requestBase } from "@/lib/site";

export const dynamic = "force-dynamic";

const Input = z.object({ character_id: z.string().min(1).max(120), redo: z.boolean().optional(), shot: z.enum(SHOTS).optional() });

/**
 * An admin draws one character's show kit (lib/show-shots.ts) at any hour, free while the day's Workers AI budget lasts:
 * `POST { character_id }` starts it after the response (`redo: true` throws away their shots first, refused ones too).
 * `redo` with a `shot` draws only that one again, as when a single shot drifted from their face, and the rest stay. It's
 * the shot's next take: another seed (the same take draws the same picture) under a new address (a ready shot's
 * address never changes, so caches would keep the old one). A refused shot isn't redone: the look changes first.
 * `GET ?character=` is what the pages see.
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  if (!(await isSignedInAdmin(db, authFromRequest(req)))) return json({ error: "not_found" }, 404);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const found = (await db.query(`select 1 from characters where id = $1`, [input.character_id])).rows.length > 0;
  if (!found) return json({ error: "not_found", message: "There's no such character." }, 404);
  const base = requestBase(req);
  if (input.redo && input.shot) {
    const { rows } = await db.query<{ id: string; status: string }>(
      `select id, status from show_shots where character_id = $1 and shot = $2 order by created_at desc limit 1`,
      [input.character_id, input.shot],
    );
    if (rows[0]?.status === "refused") {
      return json({ error: "refused", message: "That shot was refused, so it's drawn again only once the look changes." }, 409);
    }
    if (rows[0]) {
      await db.query(`update show_shots set id = $2, status = 'failed', attempts = 0, take = take + 1, error = null, updated_at = now() where id = $1`, [
        rows[0].id,
        crypto.randomUUID(),
      ]);
    }
  } else if (input.redo) {
    await db.query(`delete from show_shots where character_id = $1`, [input.character_id]);
  }
  inBackground(async () => {
    const run = await drawShowShots(db, { characterId: input.character_id, baseUrl: base, max: 9 });
    if (run.failed || run.refused || run.stopped !== "done") console.error(`[show-shots] ${input.character_id}: ${JSON.stringify(run)}`);
  });
  return json({ started: true }, 202);
});

export const GET = handle(async (req: Request) => {
  const db = await getDb();
  if (!(await isSignedInAdmin(db, authFromRequest(req)))) return json({ error: "not_found" }, 404);
  const character = new URL(req.url).searchParams.get("character")?.trim() ?? "";
  if (!character) return json({ error: "invalid_request" }, 400);
  const { rows } = await db.query<{ shot: string; status: string; error: string | null }>(
    `select shot, status, error from show_shots where character_id = $1 order by shot`,
    [character],
  );
  return json({ shots: (await shotsFor(db, [character]))[character] ?? {}, rows });
});
