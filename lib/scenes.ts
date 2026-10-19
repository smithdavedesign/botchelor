/**
 * The feedback loop for new scenes (David, 2026-10-18: "if it exists use it otherwise add it as a feedback loop for a
 * new scene requested"). A date that goes somewhere the library has no set for (lib/places.ts: a plan they agreed to by
 * text, or a move on the date) shows the generic background with the place's name, and the place is logged here when
 * the date is finished. Once per date and place, so a worker's retry or an agent's next step can't count it twice.
 * The admin page lists them by how often they're asked for (GET /api/admin/scenes). Each also gets a set drawn once
 * (lib/sets.ts); POST /api/admin/scenes draws the missing ones, most asked-for first.
 */
import { track } from "./analytics";
import { ensureSet } from "./sets";
import type { Turn } from "./conversation";
import type { Db } from "./db";
import type { DateSetup } from "./game";
import { isPlaceholder, normalizeScene, placeLabel } from "./venues";

export type SceneKind = "plan" | "move";

export { normalizeScene };

/**
 * The places a finished date went that the library has no set for: where it was booked (a texted plan's place), and
 * where they moved to on the date (lib/moves.ts).
 */
export function scenePlaces(setup: Pick<DateSetup, "venue"> | null | undefined, transcript: readonly Turn[] = []): { label: string; kind: SceneKind }[] {
  const out: { label: string; kind: SceneKind }[] = [];
  const add = (place: string | null | undefined, kind: SceneKind) => {
    const label = placeLabel(place);
    if (label && isPlaceholder(place)) out.push({ label, kind });
  };
  add(setup?.venue, "plan");
  for (const t of transcript) add(t.moved_to, "move");
  return out;
}

/** A finished date that moved (lib/moves.ts): one event with how many times, so the admin can see moves get used. */
export function trackMoves(episodeId: string, transcript: readonly Turn[], performedBy: "show" | "agent"): void {
  const moves = transcript.filter((t) => t.moved_to).length;
  if (moves) track("date_moved", { episode_id: episodeId, moves, performed_by: performedBy });
}

/** Logs a finished date's places the library has no set for. Never throws: a log must not cost a date. */
export async function logSceneRequests(
  db: Db,
  episodeId: string,
  setup: Pick<DateSetup, "venue"> | null | undefined,
  transcript: readonly Turn[] = [],
): Promise<number> {
  let logged = 0;
  for (const { label, kind } of scenePlaces(setup, transcript)) {
    const normalized = normalizeScene(label);
    if (!normalized) continue;
    try {
      const { rows } = await db.query<{ n: number }>(
        `insert into scene_requests (episode_id, normalized, label, kind) values ($1, $2, $3, $4)
         on conflict (episode_id, normalized) do nothing returning 1 as n`,
        [episodeId, normalized, label, kind],
      );
      if (rows.length) {
        logged++;
        track("scene_requested", { episode_id: episodeId, scene: normalized, kind });
      }
    } catch (err) {
      console.error("[scenes] could not log", episodeId, err instanceof Error ? err.message : "unknown");
    }
    // And its set, if it has none yet (lib/sets.ts; a no-op once drawn). Never throws.
    await ensureSet(db, label);
  }
  return logged;
}

export type SceneRequest = {
  /** The place, as most recently written. */
  label: string;
  normalized: string;
  /** How many dates went there: by a texted plan, and by a move on the date. */
  requests: number;
  plans: number;
  moves: number;
  last_at: string;
  /** The latest date that went there, to see it in context. */
  episode_id: string;
};

/** The places asked for most (then most recently): the order to make new sets in. */
export async function listSceneRequests(db: Db, limit = 50): Promise<SceneRequest[]> {
  const { rows } = await db.query<SceneRequest & { last_at: string | Date }>(
    `select normalized, (array_agg(label order by created_at desc))[1] as label, count(*)::int as requests,
            (count(*) filter (where kind = 'plan'))::int as plans, (count(*) filter (where kind = 'move'))::int as moves,
            max(created_at) as last_at, (array_agg(episode_id order by created_at desc))[1] as episode_id
       from scene_requests
      group by normalized
      order by requests desc, last_at desc
      limit $1`,
    [limit],
  );
  return rows.map((r) => ({ ...r, last_at: new Date(r.last_at).toISOString() }));
}
