/**
 * Videos that didn't come through leave a trace (2026-11-22: a night video's shot or a talking moment that failed was
 * written only to its own row, and nothing was logged or shown anywhere an admin looks). Each one logs a single
 * `[ad-video]` line, with its ids, the provider and model, and what went wrong as a short code, never the scene's words;
 * and the admins' Providers page (app/admin/after-dark/providers) lists the last week's, read from the rows themselves.
 */
import type { Db } from "../db";

/** A failure's reason as a short code for the log: the provider's HTTP status when it said one, else what kind it was. */
export function failureCode(reason: string | null | undefined): string {
  const r = reason ?? "";
  const http = /\b(Venice|Replicate|Hive)(?: answered)? (\d{3})\b/.exec(r);
  if (http) return `${http[1]} ${http[2]}`;
  const known: [RegExp, string][] = [
    [/gave up waiting/, "gave up waiting"],
    [/never started/, "never started"],
    [/no longer has/, "provider deleted it"],
    [/isn't connected any more/, "own key disconnected"],
    [/the check refused|^moderation|^age check/, "refused by the check"],
    [/Model not found/i, "model not found"],
    [/Input validation error/i, "input refused"],
    [/no output|returned no/i, "no output"],
  ];
  for (const [re, code] of known) if (re.test(r)) return code;
  return r ? "other" : "no reason kept";
}

type FailedShot = { status: string; reason?: string; provider?: string; model?: string };

/** One line per shot of a video that failed (not one its owner stopped), when the video settles. */
export function logShotFailures(reel: { id: string; kind: string | null }, shots: readonly FailedShot[], only?: readonly number[]): void {
  shots.forEach((s, k) => {
    if ((only && !only.includes(k)) || s.status !== "failed" || s.reason === "stopped") return;
    console.warn(`[ad-video] shot failed: reel ${reel.id} (${reel.kind ?? "night"}), shot ${k + 1} of ${shots.length}, ${s.provider ?? "venice"} ${s.model ?? "-"}, ${failureCode(s.reason)}`);
  });
}

/** The line for a talking moment that failed. */
export function logTalkFailure(talk: { id: string; model: string | null }, reason: string): void {
  console.warn(`[ad-video] talk failed: talk ${talk.id}, venice ${talk.model ?? "-"}, ${failureCode(reason)}`);
}

export type VideoFailure = { at: string; what: "shot" | "talk"; id: string; detail: string; provider: string; model: string | null; code: string; reason: string };

/**
 * The last week's failed shots (a stopped one isn't a failure; one that came back to its storyboard keeps its reason as
 * `last_try`) and talking moments, newest first: what the Providers page lists.
 */
export async function recentVideoFailures(db: Db, limit = 20): Promise<VideoFailure[]> {
  const shots = (
    await db.query<{ id: string; kind: string | null; k: number; n: number; provider: string; model: string | null; reason: string | null; at: Date | string }>(
      `select r.id, r.kind, x.k::int as k, jsonb_array_length(r.shots) as n, coalesce(x.s->>'provider', 'venice') as provider, x.s->>'model' as model,
              coalesce(x.s->>'reason', x.s->>'last_try') as reason, r.updated_at as at
         from adult_reels r cross join lateral jsonb_array_elements(r.shots) with ordinality as x(s, k)
        where r.updated_at > now() - interval '7 days'
          and ((x.s->>'status' = 'failed' and coalesce(x.s->>'reason', '') <> 'stopped') or (x.s->>'status' <> 'failed' and x.s ? 'last_try'))
        order by r.updated_at desc limit $1`,
      [limit],
    )
  ).rows;
  const talks = (
    await db.query<{ id: string; model: string | null; error: string | null; at: Date | string }>(
      `select id, model, error, updated_at as at from adult_talks where status = 'failed' and updated_at > now() - interval '7 days' order by updated_at desc limit $1`,
      [limit],
    )
  ).rows;
  return [
    ...shots.map((r) => ({
      at: new Date(r.at).toISOString(),
      what: "shot" as const,
      id: r.id,
      detail: `${r.kind === "clip" ? "clip" : "night video"}, shot ${r.k} of ${r.n}`,
      provider: r.provider,
      model: r.model,
      code: failureCode(r.reason),
      reason: (r.reason ?? "").slice(0, 160),
    })),
    ...talks.map((r) => ({ at: new Date(r.at).toISOString(), what: "talk" as const, id: r.id, detail: "talking moment", provider: "venice", model: r.model, code: failureCode(r.error), reason: (r.error ?? "").slice(0, 160) })),
  ]
    .sort((p, q) => q.at.localeCompare(p.at))
    .slice(0, limit);
}
