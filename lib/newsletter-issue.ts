/**
 * The Sunday letter's weekly issue (docs/newsletter.md; the list itself is lib/newsletter.ts). Built once a week, after
 * Sunday's reveal has settled, from what a signed-out visitor already sees on the site: whose secret came out (lib/weekly-
 * reveal.ts), the week's best aired dates (lib/discord-posts.ts bestAired, the digest's own ranking) and the best callers
 * (lib/streaks.ts). PG only: nothing from After Dark is ever in it. Every subscriber gets the same subject and body; only
 * the small print (their own way out) differs. The hourly lobby job sends it in batches, each confirmed address once.
 */
import type { Db } from "./db";
import { bestAired, writtenTitle, type DropDate, type DropItem } from "./discord-posts";
import {
  catchUpConfirmations,
  EMAIL_COLOURS,
  escapeHtml,
  letterEmail,
  logNewsletterSend,
  newsletterBudget,
  newsletterEmail,
  newsletterState,
  pause,
  postalAddress,
  pruneNewsletter,
  SEND_KINDS,
  subscriberCounts,
  WAITING_FOR_ADDRESS,
} from "./newsletter";
import { sendEmail } from "./email";
import { siteUrl } from "./site";
import { BOARD_DAYS, callersBoard, type CallersBoard } from "./streaks";
import { venuePhrase } from "./venues";
import { revealBoard, revealDayOf, revealTimes, VOTE_CLOSE_HOUR_UTC, type RevealResult } from "./weekly-reveal";

type Env = Record<string, string | undefined>;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** A week's letter is built in the two days after Sunday's reveal airs, or not at all: old news isn't a letter. */
export const BUILD_DAYS = 2;
/** It goes out over at most six days from when it was built, so it's done before the next one. */
export const SEND_DAYS = 6;
/** The week's best dates the letter shows. */
export const BEST_DATES = 3;
/** The best callers it names. */
export const BOARD_NAMES = 3;
/** Tries an address gets for one letter, when the provider refuses a send. */
export const SEND_TRIES = 3;
/** Letters one pass of the hourly job may send (inside the day's budget). */
const LETTERS_PER_PASS = 30;
/** How long one pass may spend sending, so the hourly job keeps its time. */
const PASS_MS = 45_000;
/** The wait between two sends: Resend's free plan takes two requests a second. */
const SEND_PAUSE_MS = 600;

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const longDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const weekDay = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** The ISO 8601 week a day is in ("2026-W46"): the letter's key, one a week. */
export function isoWeekId(day: string | Date): string {
  const at = typeof day === "string" ? new Date(`${day}T00:00:00Z`) : day;
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  // The week's Thursday decides its year; Monday is day 1 and Sunday day 7.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The latest Sunday whose reveal has aired by `now` (YYYY-MM-DD). */
export function latestAiredWeek(now: Date): string {
  const coming = revealDayOf(now);
  return now >= revealTimes(coming).airs_at ? coming : isoDay(Date.parse(`${coming}T00:00:00Z`) - 7 * DAY_MS);
}

/** The Sunday whose letter may be built at `now`: the latest reveal that aired, for BUILD_DAYS after it. Null between. */
export function letterWeek(now: Date): string | null {
  const week = latestAiredWeek(now);
  return now.getTime() - revealTimes(week).airs_at.getTime() < BUILD_DAYS * DAY_MS ? week : null;
}

/**
 * Whether that Sunday's reveal is settled, so the letter can say how it went: its voters were told (the date is on, or
 * its tries ran out), nothing was left to reveal, there was no vote that week, or the Sunday is over (the reveal is only
 * worked on that day, lib/weekly-reveal.ts runDueReveal), when the letter stops waiting for it.
 */
async function revealSettled(db: Db, week: string, now: Date): Promise<boolean> {
  const row = (
    await db.query<{ revealed_at: unknown; winner: string | null; notified_at: unknown }>(`select revealed_at, winner, notified_at from weekly_reveals where week_id = $1`, [week])
  ).rows[0];
  if (!row || row.notified_at || (row.revealed_at && !row.winner)) return true;
  return now.getTime() >= Date.parse(`${week}T00:00:00Z`) + DAY_MS;
}

export type LetterContent = { week_id: string; reveal: RevealResult | null; dates: DropItem[]; callers: CallersBoard | null };

/** What a week's letter says: that Sunday's reveal, the best dates since the last one aired, the best callers. Null with nothing to say. */
export async function letterContent(db: Db, week: string, now: Date): Promise<LetterContent | null> {
  const from = new Date(revealTimes(week).airs_at.getTime() - 7 * DAY_MS);
  const [board, dates, callers] = await Promise.all([
    revealBoard(db, null, now).catch(() => null),
    bestAired(db, from, now, BEST_DATES, now).catch(() => [] as DropItem[]),
    callersBoard(db, null, now).catch(() => null),
  ]);
  const reveal = board?.last?.week_id === week ? board.last : null;
  if (!reveal && !dates.length) return null;
  return { week_id: week, reveal, dates, callers: callers?.top.length ? callers : null };
}

/** A link from the letter: absolute, and tagged for the engagement log (utm_source=newsletter, utm_medium=email, the week). */
export function letterLink(path: string, campaign: string, base: string = siteUrl()): string {
  const url = new URL(path, base);
  url.searchParams.set("utm_source", "newsletter");
  url.searchParams.set("utm_medium", "email");
  url.searchParams.set("utm_campaign", campaign);
  return url.toString();
}

type Part = { html: string; text: string };
const H2 = `style="font-size:17px;margin:24px 0 8px;color:${EMAIL_COLOURS.ink}"`;
const A = `style="color:${EMAIL_COLOURS.link};font-weight:600"`;
const MUTED = `color:${EMAIL_COLOURS.muted}`;

function revealPart(r: RevealResult, link: (path: string) => string): Part {
  const title = `Sunday's reveal: ${r.name}'s secret is out`;
  const counts = r.producers_pick ? "Nobody voted, so the producers picked." : `${r.votes} of ${plural(r.total, "vote")}.`;
  const go = r.room_path ? (r.partner ? `${r.partner} has heard it: watch their date.` : "Watch their date.") : "See their secrets.";
  const href = link(r.room_path ?? `/characters/${encodeURIComponent(r.character_id)}#secrets`);
  return {
    html:
      `<h2 ${H2}>${escapeHtml(title)}</h2><p style="margin:0 0 8px">“${escapeHtml(r.secret)}”</p>` +
      `<p style="margin:0 0 14px;${MUTED}">${escapeHtml(counts)} <a href="${escapeHtml(href)}" ${A}>${escapeHtml(go)}</a></p>`,
    text: `${title}\n“${r.secret}”\n${counts} ${go}\n${href}`,
  };
}

const pairOf = (d: DropDate): string => `${d.a.name} × ${d.b.name}`;
const firstName = (name: string): string => name.split(/\s+/)[0] || name;

/** One of the week's dates as Watch's card says it (and the Discord digest): who, its title or setting, and where it airs. */
function dateLines(item: DropItem): { title: string; lines: string[]; path: string } {
  if (item.kind === "mixer") {
    const singles = new Set(item.dates.flatMap((d) => [d.a.id, d.b.id])).size;
    const pairs = item.dates.map((d) => `${firstName(d.a.name)} × ${firstName(d.b.name)}`);
    const where = item.venue ? ` at ${venuePhrase(item.venue)}` : "";
    return {
      title: item.theme === "recoupling" ? `The Recoupling${where}` : `Speed-dating night${where}`,
      lines: [`${plural(singles, "single")} · ${plural(item.dates.length, "table")} aired`, `${pairs.slice(0, 3).join(" · ")}${pairs.length > 3 ? ` and ${pairs.length - 3} more` : ""}`],
      path: `/mixers/${encodeURIComponent(item.night_id ?? "")}`,
    };
  }
  const [first] = item.dates;
  if (item.kind === "double") {
    return {
      title: `Double date: ${item.dates.map(pairOf).join(" and ")}`,
      lines: [item.venue ? `Two couples, one table, at ${venuePhrase(item.venue)}.` : "Two couples, one table.", clip(first.setting, 240)],
      path: `/episodes/${encodeURIComponent(first.id)}`,
    };
  }
  const title = writtenTitle(first);
  return { title: pairOf(first), lines: [...(title ? [`“${clip(title, 120)}”`] : []), clip(first.setting, 240)], path: `/episodes/${encodeURIComponent(first.id)}` };
}

function datesPart(items: readonly DropItem[], link: (path: string) => string): Part {
  const shown = items.map(dateLines);
  return {
    html:
      `<h2 ${H2}>The week's best dates</h2>` +
      shown
        .map((d) => `<p style="margin:0 0 14px"><a href="${escapeHtml(link(d.path))}" ${A}>${escapeHtml(d.title)}</a>${d.lines.map((l) => `<br><span style="${MUTED}">${escapeHtml(l)}</span>`).join("")}</p>`)
        .join("") +
      `<p style="margin:0 0 14px;${MUTED}">Guess how each one ends before you watch.</p>`,
    text: `The week's best dates\n\n${shown.map((d) => [d.title, ...d.lines, link(d.path)].join("\n")).join("\n\n")}`,
  };
}

function boardPart(c: CallersBoard, link: (path: string) => string): Part {
  const lines = c.top.slice(0, BOARD_NAMES).map((e, i) => `${i + 1}. ${e.name?.trim() ? clip(e.name.trim(), 40) : "A viewer"}: ${e.right} of ${e.called}`);
  const note = `Right endings on public dates that aired in the last ${BOARD_DAYS} days (${plural(c.callers, "caller")}). Names show only for people who put one up.`;
  const href = link("/watch#best-callers");
  return {
    html:
      `<h2 ${H2}>Best callers this week</h2><p style="margin:0 0 8px">${lines.map(escapeHtml).join("<br>")}</p>` +
      `<p style="margin:0 0 14px;${MUTED}">${escapeHtml(note)} <a href="${escapeHtml(href)}" ${A}>Call one before it airs</a></p>`,
    text: `Best callers this week\n${lines.join("\n")}\n${note}\nCall one before it airs: ${href}`,
  };
}

/** What's next, in a line: when the next vote opens. */
function nextPart(week: string, link: (path: string) => string): Part {
  const opens = revealTimes(isoDay(Date.parse(`${week}T00:00:00Z`) + 7 * DAY_MS)).opens_at;
  const line = `Next: the vote on whose secret comes out opens ${weekDay.format(opens)} at ${VOTE_CLOSE_HOUR_UTC}:00 UTC.`;
  const href = link("/watch#sunday-reveal");
  return {
    html: `<p style="margin:24px 0 0">${escapeHtml(line)} <a href="${escapeHtml(href)}" ${A}>See what's on</a></p>`,
    text: `${line}\n${href}`,
  };
}

/** The letter itself: its subject, and its body as HTML and as text, every link tagged with its week. Pure. */
export function renderLetter(c: LetterContent, base: string = siteUrl()): { id: string; subject: string; html: string; text: string } {
  const id = isoWeekId(c.week_id);
  const link = (path: string) => letterLink(path, id, base);
  const dateline = `The Sunday letter · ${longDay.format(new Date(`${c.week_id}T12:00:00Z`))}`;
  const parts = [
    { html: `<p style="margin:0 0 4px;font-size:13px;${MUTED}">${escapeHtml(dateline)}</p>`, text: dateline },
    c.reveal ? revealPart(c.reveal, link) : null,
    c.dates.length ? datesPart(c.dates, link) : null,
    c.callers ? boardPart(c.callers, link) : null,
    nextPart(c.week_id, link),
  ].filter((p): p is Part => p !== null);
  return {
    id,
    subject: c.reveal ? `The Sunday letter: ${clip(c.reveal.name, 60)}'s secret is out` : "The Sunday letter: the week's best dates",
    html: parts.map((p) => p.html).join(""),
    text: parts.map((p) => p.text).join("\n\n"),
  };
}

type IssueRow = { id: string; week_id: string; subject: string; html: string; text: string; built_at: string | Date; sent: number };

const issueById = async (db: Db, id: string): Promise<IssueRow | null> =>
  (await db.query<IssueRow>(`select id, week_id, subject, html, text, built_at, sent from newsletter_issues where id = $1`, [id])).rows[0] ?? null;

/**
 * This week's letter, built once: in the BUILD_DAYS after Sunday's reveal airs, as soon as the reveal has settled. Null
 * when none is due, the reveal is still being worked on, or the week had nothing to say (no reveal, no date aired).
 */
export async function ensureIssue(db: Db, now: Date = new Date(), env: Env = process.env): Promise<IssueRow | null> {
  const week = letterWeek(now);
  if (!week) return null;
  const existing = await issueById(db, isoWeekId(week));
  if (existing) return existing;
  if (!(await revealSettled(db, week, now))) return null;
  const content = await letterContent(db, week, now);
  if (!content) return null;
  const letter = renderLetter(content, siteUrl(env));
  await db.query(
    `insert into newsletter_issues (id, week_id, subject, html, text, built_at) values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing`,
    [letter.id, week, letter.subject, letter.html, letter.text, now.toISOString()],
  );
  return issueById(db, letter.id);
}

/** The letter being sent: the newest one built in the last SEND_DAYS, so last week's stops when this week's is built. */
async function currentIssue(db: Db, now: Date): Promise<IssueRow | null> {
  const { rows } = await db.query<IssueRow>(
    `select id, week_id, subject, html, text, built_at, sent from newsletter_issues where built_at > $1 and built_at <= $2 order by built_at desc limit 1`,
    [new Date(now.getTime() - SEND_DAYS * DAY_MS).toISOString(), now.toISOString()],
  );
  return rows[0] ?? null;
}

/**
 * The next confirmed address for a letter, claimed: one the provider refused before goes again first (while it has
 * tries left and is still on the list), then one that hasn't had it. Null when everyone has.
 */
async function claimNext(db: Db, issueId: string, now: Date): Promise<string | null> {
  const at = now.toISOString();
  const again = await db.query<{ email: string }>(
    `update newsletter_sends set tries = tries + 1, claimed_at = $2
      where issue_id = $1 and sent_at is null and claimed_at is null and tries < $3
        and email = (select s.email from newsletter_sends s join newsletter_subscribers u on u.email = s.email and u.status = 'confirmed'
                      where s.issue_id = $1 and s.sent_at is null and s.claimed_at is null and s.tries < $3
                      order by s.created_at, s.email limit 1)
      returning email`,
    [issueId, at, SEND_TRIES],
  );
  if (again.rows[0]) return again.rows[0].email;
  const fresh = await db.query<{ email: string }>(
    `insert into newsletter_sends (issue_id, email, claimed_at, created_at)
     select $1, u.email, $2, $2 from newsletter_subscribers u
      where u.status = 'confirmed' and not exists (select 1 from newsletter_sends s where s.issue_id = $1 and s.email = u.email)
      order by u.confirmed_at, u.email limit 1
     on conflict do nothing
     returning email`,
    [issueId, at],
  );
  return fresh.rows[0]?.email ?? null;
}

/** Confirmed addresses still due this letter. */
async function lettersLeft(db: Db, issueId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from newsletter_subscribers u
      where u.status = 'confirmed'
        and not exists (select 1 from newsletter_sends s where s.issue_id = $1 and s.email = u.email and (s.sent_at is not null or s.claimed_at is not null or s.tries >= $2))`,
    [issueId, SEND_TRIES],
  );
  return rows[0]?.n ?? 0;
}

export type LetterPass = { sent: number; failed: number; left: number };

/**
 * One batch of a letter: as many as the day's budget (lib/newsletter.ts newsletterBudget), the pass and the time allow,
 * each address claimed before its send. A refused send gives its claim back for a later pass and ends this one (the
 * provider is down, or busy), so an outage doesn't use up everyone's tries.
 */
export async function sendLetter(db: Db, issue: IssueRow, now: Date = new Date(), env: Env = process.env, opts: { until?: number; pauseMs?: number } = {}): Promise<LetterPass> {
  const config = newsletterEmail(env);
  let sent = 0;
  let failed = 0;
  if (config && postalAddress(env)) {
    const room = Math.min((await newsletterBudget(db, env)).letters, LETTERS_PER_PASS);
    while (sent < room && (opts.until === undefined || Date.now() < opts.until)) {
      const email = await claimNext(db, issue.id, now);
      if (!email) break;
      const msg = letterEmail(issue, email, config, env);
      try {
        if (!msg) throw new Error("no message");
        await sendEmail(msg, config);
      } catch (err) {
        console.error("[newsletter] letter failed:", err instanceof Error ? err.message : "unknown");
        await db.query(`update newsletter_sends set claimed_at = null where issue_id = $1 and email = $2 and sent_at is null`, [issue.id, email]);
        failed++;
        break;
      }
      await db.query(`update newsletter_sends set sent_at = $3 where issue_id = $1 and email = $2`, [issue.id, email, now.toISOString()]);
      await db.query(`update newsletter_issues set sent = sent + 1, last_sent_at = $2 where id = $1`, [issue.id, now.toISOString()]);
      await logNewsletterSend(db, SEND_KINDS.letter);
      sent++;
      await pause(opts.pauseMs ?? 0);
    }
  }
  return { sent, failed, left: await lettersLeft(db, issue.id) };
}

export type NewsletterRun =
  | "off"
  | typeof WAITING_FOR_ADDRESS
  | { issue: string | null; sent: number; failed: number; left: number; confirmations: number; pruned: number; pending: number; confirmed: number };

/**
 * The hourly lobby job's part (app/api/jobs/lobby): tidies the list, sends the confirmations that had to wait, then, once
 * NEWSLETTER_POSTAL_ADDRESS is set, builds the week's letter when it's due and sends its next batch. Each step stands
 * alone: one that fails leaves the rest to run. Within PASS_MS, with a pause between sends for Resend's rate limit.
 */
export async function runNewsletter(db: Db, now: Date = new Date(), opts: { env?: Env; pauseMs?: number; budgetMs?: number } = {}): Promise<NewsletterRun> {
  const env = opts.env ?? process.env;
  const state = newsletterState(env);
  if (state === "off") return "off";
  const until = Date.now() + (opts.budgetMs ?? PASS_MS);
  const pauseMs = opts.pauseMs ?? SEND_PAUSE_MS;
  const pruned = await pruneNewsletter(db, now).catch(() => 0);
  const confirmations = await catchUpConfirmations(db, now, env, { until, pauseMs }).catch(() => 0);
  if (state === "waiting_for_address") return WAITING_FOR_ADDRESS;
  await ensureIssue(db, now, env).catch((err) => console.error("[newsletter] building the letter failed:", err instanceof Error ? err.message : "unknown"));
  const issue = await currentIssue(db, now);
  const pass = issue ? await sendLetter(db, issue, now, env, { until, pauseMs }) : { sent: 0, failed: 0, left: 0 };
  const { pending, confirmed } = await subscriberCounts(db);
  return { issue: issue?.id ?? null, ...pass, confirmations, pruned, pending, confirmed };
}

/** The latest week's letter as it stands, or as it would be built now: the admin's look before it goes out. Stores nothing. */
export async function previewLetter(db: Db, now: Date = new Date(), env: Env = process.env): Promise<{ id: string; subject: string; text: string; built: boolean } | null> {
  const week = latestAiredWeek(now);
  const built = await issueById(db, isoWeekId(week));
  if (built) return { id: built.id, subject: built.subject, text: built.text, built: true };
  const content = await letterContent(db, week, now);
  if (!content) return null;
  const letter = renderLetter(content, siteUrl(env));
  return { id: letter.id, subject: letter.subject, text: letter.text, built: false };
}
