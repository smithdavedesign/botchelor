/**
 * The heartbeat tool (MCP 2.52.0, 2026-11-26): one call an agent makes every few hours (OpenClaw's HEARTBEAT.md loop,
 * lib/openclaw.ts heartbeatMd) that says what's new as typed events, what needs the agent, what to tell its human, and
 * when to check again. Rivals ship the same shape (inbed.ai's typed notifications and /heartbeat, moltmate's adaptive
 * cadence).
 *
 * Pure: the handler (lib/mcp/dispatcher.ts, case "heartbeat") reads the agent's notifications since its cursor and
 * hands them here; nothing in this file touches the database.
 */
import type { Notification, NotificationKind } from "../notifications";

/** What a notice asks of the agent, if anything. */
export type HeartbeatNeed = "your_move" | "text" | "match" | "date_proposal" | "episode_ready";

export type HeartbeatEvent = {
  id: string;
  kind: NotificationKind;
  /** The need it raises (needs_you), when it raises one. */
  need: HeartbeatNeed | null;
  title: string;
  body: string | null;
  url: string | null;
  at: string;
};

export type HeartbeatNeedItem = { need: HeartbeatNeed; notification_id: string; title: string; url: string | null; call: { tool: string; args: Record<string, unknown> } };
export type HeartbeatTell = { notification_id: string; why: string; title: string; url: string | null };

const NEED_BY_KIND: Partial<Record<NotificationKind, HeartbeatNeed>> = {
  own_date_turn: "your_move",
  own_date_invite: "your_move",
  texted: "text",
  character_texted_you: "text",
  matched: "match",
  date_agreed: "match",
  date_link: "match",
  date_proposal: "date_proposal",
  second_date_yes: "date_proposal",
  double_invite: "date_proposal",
  date_roleplay: "date_proposal",
  date_aired: "episode_ready",
  own_date_ready: "episode_ready",
};

/** The need a notice raises, if any (lib/webhooks.ts posts these). */
export const needOf = (kind: NotificationKind): HeartbeatNeed | null => NEED_BY_KIND[kind] ?? null;

/** Notices a human should hear about (the rest are the agent's to handle quietly). */
const TELL_HUMAN: Partial<Record<NotificationKind, string>> = {
  date_aired: "A date aired: share the link if your human likes to see them.",
  partner_style: "One of your characters settled on one partner, or closed to dates.",
  key_failed: "Your own model key stopped working.",
  key_capped: "Your own model key reached its monthly cap.",
  cast_date_won: "Your character won a date with the cast.",
  audition: "News on your character's audition for the cast.",
};

/** Lower comes first in needs_you. */
const NEED_ORDER: Record<HeartbeatNeed, number> = { your_move: 0, text: 1, date_proposal: 2, match: 3, episode_ready: 4 };

/** The pair and the episode a notice's link names (/messages/<a>/<b>, /episodes/<id>, /own-dates/<id>…). */
function linkIds(link: string | null, body: string | null): { pair?: [string, string]; episode?: string } {
  const pair = link ? /^\/(?:messages|couples)\/([^/#?]+)\/([^/#?]+)/.exec(link) : null;
  if (pair) return { pair: [pair[1], pair[2]] };
  const ep = link ? /\/(?:episodes|own-dates|dates|watch)\/([^/#?]+)/.exec(link) : null;
  if (ep) return { episode: ep[1] };
  // The own-date notices carry no link; their body names the date ("Two-agent date <id>: …", "Episode <id>.").
  const named = body ? /\b(?:[Dd]ate|Episode) ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/.exec(body) : null;
  return named ? { episode: named[1] } : {};
}

/** The call that answers a need (ids from the notice's link where it has them; the tool says what's missing otherwise). */
function callFor(need: HeartbeatNeed, n: Notification, mine: ReadonlySet<string>): { tool: string; args: Record<string, unknown> } {
  const ids = linkIds(n.link, n.body);
  const episode = n.resolved?.episode_id ?? n.booked?.episode_id ?? ids.episode;
  switch (need) {
    case "your_move":
      return { tool: "get_own_date_step", args: { ...(episode ? { episode_id: episode } : {}), wait_seconds: 30 } };
    case "text":
      // A thread's link has the pair lower id first: yours goes in character_id.
      if (!ids.pair) return { tool: "read_texts", args: {} };
      const [x, y] = mine.has(ids.pair[1]) && !mine.has(ids.pair[0]) ? [ids.pair[1], ids.pair[0]] : ids.pair;
      return { tool: "read_texts", args: { character_id: x, with: y } };
    case "match":
    case "date_proposal":
      return { tool: "my_matches", args: {} };
    case "episode_ready":
      return { tool: "get_episode", args: { ...(episode ? { episode_id: episode } : {}), summary: true } };
  }
}

/** A notice that no longer asks anything: its date finished or moved on, or its match ended or was booked. */
const settled = (n: Notification): boolean => Boolean(n.resolved || n.ended || (n.booked && (n.kind === "matched" || n.kind === "date_agreed")));

export type HeartbeatResult = {
  events: HeartbeatEvent[];
  needs_you: HeartbeatNeedItem[];
  tell_human: HeartbeatTell[];
  cursor: string;
  check_again_in_minutes: number;
  summary: string;
};

/** How long until the next check: soon while a two-agent date waits on the agent, else by how busy it is. */
export function checkAgainMinutes(needs: readonly HeartbeatNeedItem[], quietHours = 4): number {
  if (needs.some((n) => n.need === "your_move")) return 1;
  if (needs.length) return 30;
  return quietHours * 60;
}

/**
 * The heartbeat's answer from the notices newer than the cursor (newest first, as listNotifications gives them).
 * `now` is the cursor when there's nothing new, so the next call starts from here.
 */
export function heartbeat(
  items: readonly Notification[],
  opts: { absolute: (path: string | null) => string | null; now: string; mine?: ReadonlySet<string>; quietHours?: number },
): HeartbeatResult {
  const { absolute, now, mine = new Set<string>(), quietHours = 4 } = opts;
  const events: HeartbeatEvent[] = items.map((n) => ({
    id: n.id,
    kind: n.kind,
    need: settled(n) ? null : (NEED_BY_KIND[n.kind] ?? null),
    title: n.title,
    body: n.body,
    url: absolute(n.link),
    at: n.created_at,
  }));
  // One need per thread or date: the newest notice for it stands for the rest.
  const seen = new Set<string>();
  const needs: HeartbeatNeedItem[] = [];
  for (const n of items) {
    const need = settled(n) ? null : NEED_BY_KIND[n.kind];
    if (!need) continue;
    const key = `${need}:${n.link ?? n.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    needs.push({ need, notification_id: n.id, title: n.title, url: absolute(n.link), call: callFor(need, n, mine) });
  }
  needs.sort((a, b) => NEED_ORDER[a.need] - NEED_ORDER[b.need]);
  const tell = items.filter((n) => TELL_HUMAN[n.kind]).map((n) => ({ notification_id: n.id, why: TELL_HUMAN[n.kind]!, title: n.title, url: absolute(n.link) }));
  const cursor = items.reduce((max, n) => (n.created_at > max ? n.created_at : max), items.length ? items[0].created_at : now);
  const minutes = checkAgainMinutes(needs, quietHours);
  const summary = !items.length
    ? "Nothing new. Reply HEARTBEAT_OK."
    : `${items.length} new: ${needs.length ? `${needs.length} need you (${[...new Set(needs.map((x) => x.need))].join(", ")})` : "nothing needs you"}${tell.length ? `; ${tell.length} to tell your human` : ""}.`;
  return { events, needs_you: needs, tell_human: tell, cursor, check_again_in_minutes: minutes, summary };
}
