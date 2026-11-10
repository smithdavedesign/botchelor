/**
 * What the show posts to its Discord, and when (docs/discord.md; the posting itself is lib/discord.ts). The hourly lobby
 * job calls postDueDiscord once a pass, after the dates have aired, the reveal has run and the pool has frozen, so each
 * post says what the site says at that moment. Every post is something a signed-out visitor can already see on the site,
 * in the site's own words, and never anything from After Dark:
 *
 *  - drops (the episodes): every DROPS_EVERY_HOURS hours, the best few public dates that aired in the hours before. Never
 *    one post a date (the house crowd airs a lot of them). The season cast's dates first, then the most called and
 *    watched; a double date or a mixer night is one item. Never a private, unlisted or reported date, never one carrying
 *    an After Dark memory, never one with a private character or a test character in it. Like Watch's own cards, it never
 *    says how a date ended: the names, the title, the setting, and the spoiler-free share card.
 *  - votes: Sunday's reveal (lib/weekly-reveal.ts). Its ballot when the vote opens on Saturday, never the counts (the site
 *    shows them only to people who voted); its result when it airs on Sunday, with the counts it publishes and the date
 *    it made. And a new season's format, on its first day, with how the viewers' ballot went when it picked it.
 *  - board: the week's best callers after Sunday's reveal (lib/streaks.ts), with how many play the season pool, never
 *    the pool's names or scores while it runs; and the pool's final board when a season closes (lib/season-pool.ts).
 *    Names only as the site shows them: a display name someone put up, else "A viewer" or "An AI agent".
 *
 * An event's post goes out within a day of the event or not at all, so switching the bot on never posts old news.
 */
import type { Db } from "./db";
import { dateNumberSql } from "./date-number";
import {
  clipText,
  discordKindsOn,
  discordLink,
  discordTime,
  escapeDiscord,
  postOnce,
  unsentKeys,
  type DiscordEmbed,
  type DiscordKind,
  type DiscordMessage,
  type DiscordOpts,
  type DiscordPost,
} from "./discord";
import { episodeCardPath } from "./episode-share";
import { templateEpisodeTitle } from "./episode-title";
import { formatLabel, isDefaultFormat, type FormatId } from "./formats";
import { airedPublicSql } from "./ml-consent";
import { OUR_TEST_NAMES, TEST_NAME_SQL } from "./our-traffic";
import { venueBackdrop } from "./portraits";
import { dateLabel } from "./rules";
import { seasonCastIds } from "./season-cast";
import type { SeasonFormatDef } from "./season-format";
import { seasonFormatNow } from "./season-format-store";
import { poolBoard, poolStanding, type PoolBoard, type PoolStanding } from "./season-pool";
import { isMonthlySeason, seasonNumber } from "./season-ref";
import { ballotResult } from "./season-vote";
import { seasonIdOf, seasonLabel, seasonWindow } from "./season-window";
import { siteUrl } from "./site";
import { BOARD_DAYS, callersBoard, type CallersBoard } from "./streaks";
import { venuePhrase } from "./venues";
import { revealBoard, revealDayOf, revealTimes, type RevealBoard, type RevealResult } from "./weekly-reveal";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** An event's post goes out within this long of the event, or not at all. */
export const EVENT_FRESH_MS = DAY_MS;
/** One episode digest every this many hours: at the lobby's :20 pass after 00:00, 06:00, 12:00 and 18:00 UTC. */
export const DROPS_EVERY_HOURS = 6;
/** How many dates (or nights) one digest shows. */
export const DROPS_PER_POST = 3;
/** The most posts one pass sends: a few seconds each at worst, so the job keeps its time. */
export const MAX_POSTS_PER_PASS = 5;
/** How far back a digest looks for what the last ones featured, so a night that aired across two digests shows once. */
const DROPS_MEMORY_MS = 2 * DAY_MS;
/** A setting is cut to this in a digest (Watch's cards show about as much). */
const SETTING_MAX = 280;

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------------------------------------------------
// The episode digest

/** The digest a pass owes: the dates that aired in the DROPS_EVERY_HOURS before the slot `now` is in, keyed by that slot. */
export function dropsWindow(now: Date): { key: string; from: Date; to: Date } {
  const slot = DROPS_EVERY_HOURS * HOUR_MS;
  const to = Math.floor(now.getTime() / slot) * slot;
  return { key: `drops:${new Date(to).toISOString().slice(0, 13)}`, from: new Date(to - slot), to: new Date(to) };
}

type Side = { id: string; name: string; agent: boolean };
export type DropDate = {
  id: string;
  aired_at: number;
  title: string | null;
  setting: string;
  venue: string | null;
  format: string | null;
  date_number: number | null;
  a: Side;
  b: Side;
  /** Predictions on it, and people who watched its room: what "most called and watched" counts. */
  calls: number;
  watchers: number;
};
/** One item of a digest: a date, a double date's two tables, or a mixer night's tables. */
export type DropItem = {
  /** "e:<episode id>" or "n:<night id>": what discord_posts.items remembers. */
  key: string;
  /** What it shows as: a night with only one table in the window shows as that date, as on Watch. */
  kind: "date" | "double" | "mixer";
  /** The group night its dates belong to, if any (a lone table is still badged with it). */
  night: "double" | "mixer" | null;
  night_id: string | null;
  venue: string | null;
  theme: string | null;
  dates: DropDate[];
  /** One of this season's house cast is on it. */
  cast: boolean;
  score: number;
  aired_at: number;
};

type DropRow = {
  id: string;
  revealed_at: string | Date;
  title: string | null;
  setting: string;
  venue: string | null;
  format: string | null;
  date_number: number | null;
  group_id: string | null;
  group_kind: "double" | "mixer" | null;
  group_venue: string | null;
  group_theme: string | null;
  a_id: string;
  a_name: string;
  a_agent: boolean;
  b_id: string;
  b_name: string;
  b_agent: boolean;
  calls: number;
  watchers: number;
};

/**
 * The dates that aired in [from, to) and may be posted: aired publicly (lib/ml-consent.ts airedPublicSql: public, ready,
 * under the report threshold, no After Dark memory), both characters public, no test character (lib/our-traffic.ts).
 */
async function dropRows(db: Db, from: Date, to: Date): Promise<DropRow[]> {
  const { rows } = await db.query<DropRow>(
    `select e.id, e.revealed_at, e.title, e.setting, e.setup->>'venue' as venue, e.setup->>'format' as format,
            ${dateNumberSql("e")} as date_number,
            e.group_id, gn.kind as group_kind, gn.venue as group_venue, gn.theme as group_theme,
            a.id as a_id, a.name as a_name, a.created_via = 'mcp' as a_agent,
            b.id as b_id, b.name as b_name, b.created_via = 'mcp' as b_agent,
            (select count(*)::int from predictions p where p.episode_id = e.id) as calls,
            (select count(*)::int from watch_presence wp join watch_parties w on w.id = wp.party_id where w.episode_id = e.id) as watchers
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
       left join group_nights gn on gn.id = e.group_id
      where ${airedPublicSql("e")}
        and e.revealed_at >= $1 and e.revealed_at < $2
        and a.visibility = 'public' and b.visibility = 'public'
        and not (a.name = any($3::text[]) or b.name = any($3::text[]) or a.name ~* $4 or b.name ~* $4)
      order by e.revealed_at, e.id
      limit 500`,
    [from.toISOString(), to.toISOString(), [...OUR_TEST_NAMES], TEST_NAME_SQL],
  );
  return rows;
}

/** The rows as digest items: a double date's or a mixer's tables become one item. Pure. */
export function groupDrops(rows: readonly DropRow[], castIds: ReadonlySet<string>): DropItem[] {
  const items = new Map<string, DropItem>();
  for (const r of rows) {
    const date: DropDate = {
      id: r.id,
      aired_at: new Date(r.revealed_at).getTime(),
      title: r.title,
      setting: r.setting,
      venue: r.venue,
      format: r.format,
      date_number: r.date_number,
      a: { id: r.a_id, name: r.a_name, agent: r.a_agent },
      b: { id: r.b_id, name: r.b_name, agent: r.b_agent },
      calls: r.calls,
      watchers: r.watchers,
    };
    const nightId = r.group_id && r.group_kind ? r.group_id : null;
    const key = nightId ? `n:${nightId}` : `e:${r.id}`;
    const item: DropItem = items.get(key) ?? {
      key,
      kind: "date",
      night: nightId ? r.group_kind : null,
      night_id: nightId,
      venue: r.group_venue ?? r.venue,
      theme: r.group_theme,
      dates: [],
      cast: false,
      score: 0,
      aired_at: 0,
    };
    item.dates.push(date);
    item.cast = item.cast || castIds.has(date.a.id) || castIds.has(date.b.id);
    item.score += date.calls + date.watchers;
    item.aired_at = Math.max(item.aired_at, date.aired_at);
    items.set(key, item);
  }
  // A night shows as a night once two of its tables are in; one alone reads as that date (lib/game.ts listAiredFeed).
  return [...items.values()].map((i) => ({ ...i, kind: i.night && i.dates.length > 1 ? i.night : "date" }));
}

/** Best first: the season cast's, then the most called and watched, then the newest. Pure. */
export function rankDrops(items: readonly DropItem[]): DropItem[] {
  return [...items].sort((x, y) => Number(y.cast) - Number(x.cast) || y.score - x.score || y.aired_at - x.aired_at || (x.key < y.key ? -1 : 1));
}

/** What the digests of the last couple of days featured. */
async function recentlyFeatured(db: Db, now: Date): Promise<Set<string>> {
  const { rows } = await db.query<{ items: string[] }>(`select items from discord_posts where kind = 'drops' and posted_at > $1`, [
    new Date(now.getTime() - DROPS_MEMORY_MS).toISOString(),
  ]);
  return new Set(rows.flatMap((r) => (Array.isArray(r.items) ? r.items : [])));
}

/** The digest for the dates that aired in [from, to): up to DROPS_PER_POST items, best first, none featured lately. */
export async function episodeDigest(db: Db, from: Date, to: Date, now: Date = new Date()): Promise<DropItem[]> {
  const [rows, recent] = await Promise.all([dropRows(db, from, to), recentlyFeatured(db, now)]);
  return rankDrops(groupDrops(rows, new Set(seasonCastIds(now))).filter((i) => !recent.has(i.key))).slice(0, DROPS_PER_POST);
}

/**
 * The best `n` items that aired in [from, to), by the digest's own rules (the same dates may be posted, the same
 * ranking), whatever Discord featured: the Sunday letter's week (lib/newsletter-issue.ts). Read a day at a time, so a busy
 * week isn't cut short by dropRows' limit.
 */
export async function bestAired(db: Db, from: Date, to: Date, n: number, now: Date = new Date()): Promise<DropItem[]> {
  const rows: DropRow[] = [];
  for (let at = from.getTime(); at < to.getTime(); at += DAY_MS) rows.push(...(await dropRows(db, new Date(at), new Date(Math.min(at + DAY_MS, to.getTime())))));
  return rankDrops(groupDrops(rows, new Set(seasonCastIds(now)))).slice(0, n);
}

const pairOf = (d: DropDate): string => `${d.a.name} × ${d.b.name}`;
const firstName = (name: string): string => name.split(/\s+/)[0] || name;

/** The episode's own title (lib/episode-title.ts) when one was written; the template one would only repeat the setting. */
export function writtenTitle(d: DropDate): string | null {
  if (!d.title) return null;
  return d.title === templateEpisodeTitle({ venue: d.venue, dateNumber: d.date_number }) ? null : d.title;
}

/** The badges Watch's card shows, as words: which date it is, a group night, its format, who made the characters. */
function badges(dates: readonly DropDate[], group: string | null): string[] {
  const first = dates[0];
  const out: string[] = [];
  if (first.date_number && first.date_number > 1) out.push(dateLabel(first.date_number));
  if (group) out.push(group);
  const format = first.format as FormatId | null;
  // A mixer's tables are all speed dates: the format would say what "Speed dating" already does.
  if (format && !isDefaultFormat(format) && !(group === "Speed dating" && format === "speed_date")) out.push(formatLabel(format));
  const sides = dates.flatMap((d) => [d.a, d.b]);
  const agents = sides.filter((s) => s.agent).length;
  if (agents) out.push(agents === sides.length ? (sides.length === 2 ? "Both made by AI agents" : "All made by AI agents") : "Made by an AI agent");
  return out;
}

function dateEmbed(d: DropDate, group: string | null, base: string, lead: boolean): DiscordEmbed {
  const title = writtenTitle(d);
  const tags = badges([d], group);
  return {
    title: escapeDiscord(pairOf(d)),
    url: discordLink(`/episodes/${encodeURIComponent(d.id)}`, "drops", "digest", base),
    description: [title ? `“${escapeDiscord(clipText(title, 120))}”` : null, escapeDiscord(clipText(d.setting, SETTING_MAX))].filter(Boolean).join("\n"),
    ...(tags.length ? { footer: { text: tags.join(" · ") } } : {}),
    timestamp: new Date(d.aired_at).toISOString(),
    // The share card (app/api/og/episode/[id]): both faces and "How does it end?", never the ending.
    ...(lead ? { image: { url: `${base}${episodeCardPath(d.id)}` } } : {}),
  };
}

function doubleEmbed(item: DropItem, base: string, lead: boolean): DiscordEmbed {
  const [first] = item.dates;
  const tags = badges(item.dates, "Double date");
  return {
    title: `Double date: ${item.dates.map((d) => escapeDiscord(pairOf(d))).join(" and ")}`,
    // The first table's page links the other couple's.
    url: discordLink(`/episodes/${encodeURIComponent(first.id)}`, "drops", "digest", base),
    description: [item.venue ? `Two couples, one table, at ${escapeDiscord(venuePhrase(item.venue))}.` : "Two couples, one table.", escapeDiscord(clipText(first.setting, SETTING_MAX))].join("\n"),
    footer: { text: tags.join(" · ") },
    timestamp: new Date(item.aired_at).toISOString(),
    ...(lead ? { image: { url: `${base}${episodeCardPath(first.id)}` } } : {}),
  };
}

/** A mixer night, as Watch's night card says it: the room, how many sat down and aired, and a few of the pairs. */
function mixerEmbed(item: DropItem, base: string, lead: boolean): DiscordEmbed {
  const singles = new Set(item.dates.flatMap((d) => [d.a.id, d.b.id])).size;
  const pairs = item.dates.map((d) => `${firstName(d.a.name)} × ${firstName(d.b.name)}`);
  const more = pairs.length > 3 ? ` and ${pairs.length - 3} more` : "";
  const where = item.venue ? ` at ${venuePhrase(item.venue)}` : "";
  const photo = venueBackdrop(item.venue);
  return {
    title: escapeDiscord(item.theme === "recoupling" ? `The Recoupling${where}` : `Speed-dating night${where}`),
    url: discordLink(`/mixers/${encodeURIComponent(item.night_id ?? "")}`, "drops", "digest", base),
    description: `${plural(singles, "single")} · ${plural(item.dates.length, "table")} aired\n${escapeDiscord(pairs.slice(0, 3).join(" · "))}${more}`,
    timestamp: new Date(item.aired_at).toISOString(),
    ...(lead && photo ? { image: { url: `${base}${photo}` } } : {}),
  };
}

/** The digest post: a line, then one embed an item, the best first (with its picture). */
export function dropsMessage(items: readonly DropItem[], base: string = siteUrl()): DiscordMessage {
  return {
    content: `📺 **Just aired on Botchelor.** Picked from the last ${DROPS_EVERY_HOURS} hours: guess how each one ends, then watch.`,
    embeds: items.map((item, i) => {
      const lead = i === 0;
      if (item.kind === "mixer") return mixerEmbed(item, base, lead);
      if (item.kind === "double") return doubleEmbed(item, base, lead);
      // A night's lone table in this window: badged with the night it belongs to, as Watch's card does.
      return dateEmbed(item.dates[0], item.night === "double" ? "Double date" : item.night === "mixer" ? "Speed dating" : null, base, lead);
    }),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Sunday's reveal and the season's format

/** The vote is open: the ballot as the site shows it to someone who hasn't voted (who, and how many secrets are out). */
export function revealOpenMessage(board: RevealBoard, base: string = siteUrl()): DiscordMessage {
  return {
    content: "🔓 **Sunday's reveal: the vote is open.** Whose secret comes out?",
    embeds: [
      {
        title: "Sunday's reveal: whose secret comes out?",
        url: discordLink("/watch#sunday-reveal", "votes", "reveal_open", base),
        description:
          `Most votes wins. At ${discordTime(board.airs_at)} their next secret comes out, and they go on a date with the cast member ` +
          `they've dated most, who has heard it. Watch it live: the characters still decide how it ends.\n\n` +
          `One vote each, on the site. The vote closes ${discordTime(board.closes_at, "R")}.`,
        fields: board.choices.map((c) => ({ name: escapeDiscord(c.name), value: `${c.out} of ${c.total} secrets out`, inline: true })),
      },
    ],
  };
}

/** The result, as the site's result line says it: whose secret, the secret, the counts (or the producers' pick), the date. */
export function revealResultMessage(last: RevealResult, base: string = siteUrl()): DiscordMessage {
  const name = escapeDiscord(last.name);
  const counts = last.producers_pick ? "Nobody voted, so the producers picked." : `${last.votes} of ${plural(last.total, "vote")}.`;
  const next = last.room_path ? (last.partner ? `${escapeDiscord(last.partner)} has heard it: watch their date.` : "Watch their date.") : "See their secrets.";
  return {
    content: `🔓 **Sunday's reveal: ${name}'s secret is out.**`,
    embeds: [
      {
        title: `${name}'s secret is out`,
        url: discordLink(last.room_path ?? `/characters/${encodeURIComponent(last.character_id)}#secrets`, "votes", "reveal_result", base),
        description: `“${escapeDiscord(last.secret)}”\n\n${counts} ${next}`,
      },
    ],
  };
}

/** A new season: its format and announcement, and the viewers' pick when the ballot chose it (as /watch's season line). */
export function seasonMessage(def: SeasonFormatDef, seasonId: string, picked: { votes: number; total: number } | null, base: string = siteUrl()): DiscordMessage {
  const number = seasonNumber(seasonId);
  const name = `${number ? `Season ${number}` : seasonLabel(seasonId)}: ${def.title}`;
  return {
    content: `📺 **${name} is on.**`,
    embeds: [
      {
        title: `${def.emoji} ${name}`,
        url: discordLink("/watch#this-week", "votes", "season_format", base),
        description: [
          def.announce,
          picked ? `🗳️ Picked by the viewers: **${def.title}**, ${picked.votes} of ${plural(picked.total, "vote")}.` : null,
          "Next month's ballot is open on the site.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The board

/** A display name someone put up, or who they are, as the site's boards say it. */
const boardName = (name: string | null, agent = false): string => (name?.trim() ? escapeDiscord(clipText(name, 40)) : agent ? "An AI agent" : "A viewer");

/** The week's board: this week's best callers (as /watch shows them), and how many play the season pool. */
export function boardMessage(callers: CallersBoard, pool: PoolStanding | null, base: string = siteUrl()): DiscordMessage {
  const lines = callers.top.map((e, i) => `**${i + 1}.** ${boardName(e.name)}: ${e.right} of ${e.called}`);
  const embeds: DiscordEmbed[] = [
    {
      title: "Best callers this week",
      url: discordLink("/watch#best-callers", "board", "callers", base),
      description:
        `${lines.join("\n")}\n\nRight endings on public dates that aired in the last ${BOARD_DAYS} days (${plural(callers.callers, "caller")}). ` +
        "Names show only for people who put one up.",
    },
  ];
  if (pool && pool.players > 0) {
    embeds.push({
      title: "The season pool",
      url: discordLink("/watch#season-pool", "board", "pool", base),
      description:
        `${pool.players} ${pool.players === 1 ? "player has" : "players have"} points so far. Every right call, drama pick, dealbreaker guess, ` +
        `arc, dare and backing this month adds up to one score. The board, with names, comes out when the season closes ${discordTime(pool.reveals_at, "R")}.`,
    });
  }
  return { content: "🏆 **This week's board.** Call an ending before it airs to get on it.", embeds };
}

/** A closed season's pool, as its finale page shows it: the top places (ties share one) and how many played. */
export function poolMessage(board: PoolBoard, base: string = siteUrl()): DiscordMessage {
  const lines = board.top.map((e) => `**${e.place}.** ${boardName(e.name, e.agent)}: ${e.points} pts`);
  return {
    content: `🏆 **The ${board.label} pool is out.**`,
    embeds: [
      {
        title: `The ${board.label} pool`,
        url: discordLink(`${board.path}#pool`, "board", "pool_reveal", base),
        description: `${lines.join("\n")}\n\n${plural(board.players, "player")}. Names show only for people who put one up.`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// When

type Built = Omit<DiscordPost, "key" | "kind">;
type Due = { key: string; kind: DiscordKind; build: (db: Db, now: Date, base: string) => Promise<Built | null> };

/** The week whose vote closed last, while its result and board are fresh: from Sunday's close to a day after it airs. */
function closedWeek(now: Date): { week: string; airs_at: Date } | null {
  const coming = revealDayOf(now);
  for (const week of [coming, isoDay(Date.parse(`${coming}T00:00:00Z`) - 7 * DAY_MS)]) {
    const t = revealTimes(week);
    if (t.closes_at <= now && now.getTime() - t.airs_at.getTime() < EVENT_FRESH_MS) return { week, airs_at: t.airs_at };
  }
  return null;
}

async function dropsPost(db: Db, from: Date, to: Date, now: Date, base: string): Promise<Built | null> {
  const items = await episodeDigest(db, from, to, now);
  return items.length ? { message: dropsMessage(items, base), items: items.map((i) => i.key) } : null;
}

async function revealOpenPost(db: Db, now: Date, base: string): Promise<Built | null> {
  const board = await revealBoard(db, null, now);
  return board?.state === "open" && board.choices.length >= 2 ? { message: revealOpenMessage(board, base) } : null;
}

/** Once its voters were told (the date is on, or its tries ran out), so the post can link the date. */
async function revealResultPost(db: Db, week: string, now: Date, base: string): Promise<Built | null> {
  const last = (await revealBoard(db, null, now))?.last;
  if (!last || last.week_id !== week || now.getTime() - Date.parse(last.at) >= EVENT_FRESH_MS) return null;
  const told = (await db.query<{ told: boolean }>(`select notified_at is not null as told from weekly_reveals where week_id = $1`, [week])).rows[0]?.told;
  return told ? { message: revealResultMessage(last, base) } : null;
}

async function boardPost(db: Db, now: Date, base: string): Promise<Built | null> {
  const [callers, pool] = await Promise.all([callersBoard(db, null, now), poolStanding(db, null, now).catch(() => null)]);
  return callers.top.length ? { message: boardMessage(callers, pool, base) } : null;
}

async function poolPost(db: Db, seasonId: string, now: Date, base: string): Promise<Built | null> {
  const board = await poolBoard(db, seasonId, null);
  return board && now.getTime() - Date.parse(board.frozen_at) < EVENT_FRESH_MS ? { message: poolMessage(board, base) } : null;
}

async function seasonPost(db: Db, seasonId: string, now: Date, base: string): Promise<Built | null> {
  const def = await seasonFormatNow(db, now);
  const ballot = await ballotResult(db, seasonId).catch(() => null);
  const picked = ballot?.winner && ballot.winner === def.slug ? { votes: ballot.votes, total: ballot.total } : null;
  return { message: seasonMessage(def, seasonId, picked, base) };
}

/**
 * The posts that may be due at `now`, each with its key; a builder returns null when there's nothing to say yet (no date
 * aired, the result not out), and a later pass asks again.
 */
export function duePosts(now: Date): Due[] {
  const out: Due[] = [];
  const drops = dropsWindow(now);
  out.push({ key: drops.key, kind: "drops", build: (db, at, base) => dropsPost(db, drops.from, drops.to, at, base) });

  // Sunday's reveal: the ballot while its vote is open (Saturday 19:00 to Sunday 19:00 UTC)...
  const week = revealDayOf(now);
  const times = revealTimes(week);
  if (now >= times.opens_at && now < times.closes_at) out.push({ key: `reveal_open:${week}`, kind: "votes", build: revealOpenPost });
  // ...then its result, and the week's board once the result has aired.
  const closed = closedWeek(now);
  if (closed) {
    out.push({ key: `reveal_result:${closed.week}`, kind: "votes", build: (db, at, base) => revealResultPost(db, closed.week, at, base) });
    if (now >= closed.airs_at) out.push({ key: `board:${closed.week}`, kind: "board", build: boardPost });
  }

  // A season's first day: its format, and the closed season's pool (frozen by the same pass, lib/season-pool.ts).
  const { start } = seasonWindow(now);
  if (now.getTime() - start.getTime() < EVENT_FRESH_MS) {
    const season = seasonIdOf(now);
    if (isMonthlySeason(season)) out.push({ key: `season:${season}`, kind: "votes", build: (db, at, base) => seasonPost(db, season, at, base) });
    const prev = seasonIdOf(new Date(start.getTime() - 1));
    if (isMonthlySeason(prev)) out.push({ key: `pool:${prev}`, kind: "board", build: (db, at, base) => poolPost(db, prev, at, base) });
  }
  return out;
}

export type DiscordPass = { off: true } | { posted: string[]; failed: string[] };

/**
 * The hourly lobby job's part: every post that's due and not yet sent, each once (lib/discord.ts postOnce). Off (and
 * reading nothing) until a webhook is set. Never throws for one post's sake: a post that can't be built waits for the
 * next pass.
 */
export async function postDueDiscord(db: Db, now: Date = new Date(), opts: DiscordOpts = {}): Promise<DiscordPass> {
  const env = opts.env ?? process.env;
  const on = new Set(discordKindsOn(env));
  if (!on.size) return { off: true };
  const base = opts.base ?? siteUrl(env);
  const due = duePosts(now).filter((d) => on.has(d.kind));
  const open = await unsentKeys(
    db,
    due.map((d) => d.key),
    now,
  );
  const pass = { posted: [] as string[], failed: [] as string[] };
  let sends = 0;
  for (const d of due) {
    if (!open.has(d.key) || sends >= MAX_POSTS_PER_PASS) continue;
    const built = await d.build(db, now, base).catch(() => null);
    if (!built) continue;
    sends++;
    const result = await postOnce(db, { key: d.key, kind: d.kind, ...built }, { ...opts, env, now, base });
    if (result === "posted") pass.posted.push(d.key);
    else if (result === "failed") pass.failed.push(d.key);
  }
  return pass;
}
