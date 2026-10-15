/**
 * M10 — product analytics + unit economics.
 *
 * One structured JSON line per event to stdout, which Vercel captures as the system log (and a log
 * drain can ship onward to a warehouse). This is the hosted-app equivalent of the system-log emitter
 * the local runtime uses. Deliberately free of PII and character content: ids, enums and counts only —
 * never names, bios, dialogue, notes or soul data (PRD §14: "without placing sensitive character content
 * or personal information in analytics events").
 */
export type AnalyticsEvent =
  | "episode_created"
  | "episode_generated" // the unit-economics event: model calls + latency for one date
  | "prediction_submitted"
  | "purchase_completed"
  | "content_reported"
  | "generation_failed"
  | "conversation_failed" // the best-effort two-agent conversation gave up (the date still airs, with no thread)
  | "daily_job" // the daily cron: lobby refresh + transcript backfill + queued-job backstop
  | "date_quality"; // the free genuineness metrics for one generated conversation (lib/quality.ts) — no content

type Props = Record<string, string | number | boolean | null | undefined>;

/** Emit one analytics event. Never throws: logging must not break a request. */
export function track(event: AnalyticsEvent, props: Props = {}): void {
  try {
    const clean: Record<string, unknown> = { log: "analytics", event };
    for (const [k, v] of Object.entries(props)) if (v !== undefined) clean[k] = v;
    clean.at = new Date().toISOString();
    console.log(JSON.stringify(clean));
  } catch {
    /* ignore: analytics must never be load-bearing */
  }
}

/** Unit economics for one generated episode (no content): how many model calls, how long, which model. */
export function trackEpisodeCost(props: {
  episode_id: string;
  model: "free" | "frontier";
  model_calls: number;
  ms: number;
  transcript_turns: number;
}): void {
  track("episode_generated", props);
}

/**
 * The genuineness metrics for one generated date (lib/quality.ts), logged so quality on real dates is watched
 * for free, every day — numbers only, never a line of dialogue.
 */
export function trackDateQuality(
  episode_id: string,
  where: string,
  plan: "director" | "rules" | null,
  q: {
    index: number; turns: number; profile_reading: number; self_labels: number; self_quotes: number; misgendered: number;
    abrupt_flips: number; repeated_openers: number; repeated_actions: number; name_tics: number; question_rate: number;
    responsiveness: number; distinctness: number;
  },
): void {
  track("date_quality", {
    episode_id, where, plan, index: q.index, turns: q.turns, profile_reading: q.profile_reading, self_labels: q.self_labels,
    self_quotes: q.self_quotes, misgendered: q.misgendered, abrupt_flips: q.abrupt_flips, repeated_openers: q.repeated_openers,
    repeated_actions: q.repeated_actions, name_tics: q.name_tics, question_rate: q.question_rate, responsiveness: q.responsiveness, distinctness: q.distinctness,
  });
}
