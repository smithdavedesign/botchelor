import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { airIfDue } from "@/lib/air";
import { dateFilm, dateFilmOn, filmDate, filmStatus } from "@/lib/date-film";
import { getDb } from "@/lib/db";
import { handle, json, jsonWhenDone, readJsonOr } from "@/lib/http";

export const dynamic = "force-dynamic";
/** A confessional takes a couple of minutes at the model; two of them and the scenes fit inside this. */
export const maxDuration = 600;

/**
 * Owner-only (a signed-in admin account, or the admin key x-frontier-key: lib/admin-auth.ts).
 *
 * GET: what filming has cost today and this month against its ceilings, and the newest dates on film.
 *
 * POST { episode, only?: "scenes" | "confessionals" }: films what that date is still missing (lib/date-film.ts
 * filmDate) and answers when it's done, with what was made, what it spent and the date's film as its page carries it.
 * The day's clip script asks this before it cuts the day's video (scripts/clips/daily-episode.mjs), and the hourly job
 * does the same for the home clip's date. Whatever the caller says, the route checks the date itself (aired, public,
 * not hidden, both characters public) and holds every paid clip against the day's and the month's ceilings.
 * Streamed (lib/http.ts jsonWhenDone): the work outlasts the edge's 100 s cutoff.
 */
export const GET = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  return json({ ok: true, ...(await filmStatus(await getDb())) });
});

export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  if (!dateFilmOn()) return json({ error: "off", message: "DATE_FILM is off." }, 404);
  const body = (await readJsonOr(req, 4096, {})) as { episode?: unknown; only?: unknown };
  const episode = typeof body.episode === "string" ? body.episode.trim() : "";
  if (!/^[\w-]{1,64}$/.test(episode)) return json({ error: "invalid_episode", message: "episode: the date's id." }, 400);
  const only = body.only === "scenes" || body.only === "confessionals" ? body.only : undefined;
  return jsonWhenDone(req, async () => {
    const db = await getDb();
    // As the date's own page does: a date whose window has closed airs when it's opened (lib/air.ts).
    await airIfDue(db, episode).catch(() => null);
    const run = await filmDate(db, episode, { only });
    const ok = run.stopped === "done";
    return { ok, ...run, film: ok ? await dateFilm(db, episode) : null, budget: await filmStatus(db).then(({ recent: _recent, ...b }) => b) };
  });
});
