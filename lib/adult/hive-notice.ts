/**
 * What the scene page says while Hive's breaker is open (lib/adult/hive-limit.ts). No server imports: the page's client
 * components use it.
 */

/** "21:45 UTC": when a pause ends, as the page and the log say it. */
export const pauseClock = (until: string): string => `${new Date(until).toISOString().slice(11, 16)} UTC`;

/** The breaker as the scene page gets it: until when it's paused, and what Hive answered last (null: unreachable). */
export type HiveNotice = { until: string; status: number | null };

/**
 * The notice near the picture and video controls, and the disabled buttons' tooltip: "Pictures and videos are paused:
 * Hive, the safety check, is refusing (429) until about 21:45 UTC."
 */
export const hiveNoticeText = (n: HiveNotice): string =>
  `Pictures and videos are paused: Hive, the safety check, is ${n.status === null ? "not answering" : `refusing (${n.status})`} until about ${pauseClock(n.until)}.`;
