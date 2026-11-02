/**
 * Leaked from the cast group chat (docs/ideas.md "Bringing viewers back", idea 14; wave 2, 2026-11-02). Once a day the
 * show "leaks" 3–6 messages from this season's cast group chat, reacting to what aired the day before: the dates, the
 * dare, the recoupling. A daily reason to come back that costs almost nothing, shown on /watch and in Since you were here.
 *
 *  - Written once a day, for the UTC day that just ended, by the hourly lobby job (ensureCastChat): one call on the
 *    show's free model (getModel(…, false), the season-recap / mixer-voice pattern), a template chat built from the
 *    same facts when the call fails or too few of its messages pass. Stored (cast_chats, one row a day), so a page view
 *    never calls a model. About 1,500 tokens in and 300 out: $0 on the free tier, ~0.12¢ a day at paid flash-lite rates.
 *  - What the writer may know: only what has aired publicly — public dates between public characters that aired that
 *    day (not reported away) with how they ended, the dare's reveal, the recoupling night's vote, and secrets that came
 *    out that day. Nothing unaired, nothing private. So nothing it can say spoils a date a viewer could still predict.
 *  - Every message is checked: it must come from a cast member, pass the PG checks (lib/safety.ts checkSheetText and
 *    checkShowText), read in English, and never give away a secret that isn't out yet (lib/cast-secrets.ts
 *    hiddenCastSecrets, matched like a date's slip). The writer is never shown a hidden secret in the first place.
 *  - A quiet day (nothing aired) writes nothing; the page keeps showing the last chat while it's recent.
 */
import { dateNumberSql } from "./date-number";
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { episodeCode } from "./episode-title";
import { needsTranslation } from "./language-check";
import { getModel, type Model } from "./model";
import { shortName } from "./names";
import { castSecrets, hiddenCastSecrets, slipped } from "./cast-secrets";
import { dareReveal } from "./dares";
import { portraitPathSql } from "./assets";
import { dateLabel, REPORT_HIDE_THRESHOLD, type Ending } from "./rules";
import { checkSheetText, checkShowText } from "./safety";
import { seasonCastIds } from "./season-cast";
import { venuePhrase } from "./venues";

export const CHAT_MIN = 3;
export const CHAT_MAX = 6;
export const CHAT_LINE_MAX = 160;
/** How long a chat stays on /watch when the days after it were quiet. */
export const CHAT_SHOWN_DAYS = 3;
/** How many aired dates the writer is told about (the cast's own first). */
const FACT_DATES = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
const CODE_FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

// On in production; the shared test harness turns it off (its fire-and-forget calls would eat scripted outputs).
// tests/cast-chat.test.ts passes a model of its own.
let voiceEnabled = true;
export function setCastChatVoiceEnabledForTests(on: boolean): void {
  voiceEnabled = on;
}

export type ChatLine = { character_id: string; text: string };

type CastMember = { id: string; name: string; bio: string };
type AiredDate = { a: string; b: string; a_name: string; b_name: string; ending: Ending; venue: string | null; date_number: number | null; episode_id: string };
export type ChatFacts = {
  day: string;
  code: string | null;
  cast: CastMember[];
  dates: AiredDate[];
  dare: { name: string; text: string; outcome: string } | null;
  recoupling: { ask: string; winner: string | null } | null;
  secrets: { name: string; secret: string }[];
};

const dayStart = (day: string) => new Date(`${day}T00:00:00Z`);
/** The day as of its last moment (or now, if it's still running): a day on the 1st belongs to the season that just closed. */
const asOfDay = (day: string, now: Date) => new Date(Math.min(dayStart(day).getTime() + DAY_MS - 1, now.getTime()));
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** How an aired date ended, in a gossip's words (it has aired: this is the public record, not a spoiler). */
function endedWords(d: AiredDate): string {
  if (d.ending === "second_date") return `both wanted a ${dateLabel((d.date_number ?? 1) + 1).toLowerCase()}`;
  if (d.ending === "friends") return "they parted as friends";
  return "it went badly";
}

/** Everything the writer may know about one UTC day: public, aired, and nothing else. */
export async function chatFacts(db: Db, day: string, now: Date = new Date()): Promise<ChatFacts> {
  const from = dayStart(day);
  const to = new Date(from.getTime() + DAY_MS);
  const castIds = seasonCastIds(from);
  const [cast, dates, nights] = await Promise.all([
    db.query<CastMember>(`select id, name, bio from characters where id = any($1) and visibility = 'public'`, [castIds]),
    db.query<AiredDate>(
      `select e.id as episode_id, e.character_a as a, e.character_b as b, ca.name as a_name, cb.name as b_name, e.ending,
              e.setup->>'venue' as venue, ${dateNumberSql("e")} as date_number
         from episodes e join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b
        where e.revealed_at >= $1 and e.revealed_at < $2 and e.revealed_at <= $5 and e.status = 'ready' and e.visibility = 'public'
          and e.ending is not null and ca.visibility = 'public' and cb.visibility = 'public'
          and (select count(*) from reports r where r.episode_id = e.id) < $3
        order by (e.character_a = any($4) or e.character_b = any($4)) desc, e.revealed_at desc
        limit ${FACT_DATES}`,
      [from.toISOString(), to.toISOString(), REPORT_HIDE_THRESHOLD, castIds, now.toISOString()],
    ),
    db.query<{ question: string; winner: string | null; choices: { id: string; label: string }[] }>(
      `select question, winner, choices from recoupling_nights where night_at = $1 and night_id is not null`,
      [day],
    ),
  ]);
  // The dare whose date aired that day, as its reveal reads it.
  const dareRow = (
    await db.query<{ episode_id: string }>(
      `select n.episode_id from dare_nights n join episodes e on e.id = n.episode_id
        where e.revealed_at >= $1 and e.revealed_at < $2 and e.revealed_at <= $3 and e.visibility = 'public' limit 1`,
      [from.toISOString(), to.toISOString(), now.toISOString()],
    )
  ).rows[0];
  const reveal = dareRow ? await dareReveal(db, dareRow.episode_id).catch(() => null) : null;
  const night = nights.rows[0];
  // Secrets that came out that day (they're public now), never one still hidden.
  const secrets: ChatFacts["secrets"] = [];
  for (const c of cast.rows) {
    const s = await castSecrets(db, c.id, asOfDay(day, now)).catch(() => null);
    for (const o of s?.out ?? []) if (o.at >= from.toISOString() && o.at < to.toISOString()) secrets.push({ name: shortName(c.name), secret: o.secret });
  }
  return {
    day,
    code: episodeCode(from),
    cast: cast.rows,
    dates: dates.rows,
    dare: reveal
      ? {
          name: shortName(reveal.name),
          text: reveal.text,
          outcome: reveal.followed === true ? "went through with it" : reveal.followed === false ? "chickened out" : "sort of did it",
        }
      : null,
    recoupling: night
      ? {
          ask: night.question === "newcomer" ? "who joins next season's cast" : "which couple is in trouble",
          winner: night.choices.find((c) => c.id === night.winner)?.label ?? null,
        }
      : null,
    secrets,
  };
}

/** Whether a day had anything to gossip about. */
export const hasNews = (f: ChatFacts): boolean => f.dates.length > 0 || f.dare !== null || f.recoupling !== null || f.secrets.length > 0;

const SYSTEM =
  "You write the leaked cast group chat for Botchelor, an AI reality-dating show the audience watches. " +
  "It's the morning after: this season's cast text each other about what aired yesterday. " +
  `Write ${CHAT_MIN} to ${CHAT_MAX} short messages (each under 120 characters) from the cast members listed, at least three different people. ` +
  "It's a real group chat, not a recap: people reply to each other, tease, take sides, ask a pointed question, play coy about their own date. " +
  "Mostly they gossip about OTHER people's dates; one sharp detail beats a summary, and nobody explains the plot. " +
  "Each person sounds like themselves (use their bio for voice, not as a topic). Dry and playful, never cruel. " +
  "PG, adults, no real people or brands, no hashtags, at most one emoji in the whole chat. " +
  "React ONLY to the facts given: never invent how any other date went, never predict an ending, never mention any secret except the ones listed as out. " +
  'The tone, not the content: "Goat yoga. On a first date. Who signed off on this?" / "I did. Best idea I\'ve had all month." / "The goat looked happier than either of you." ' +
  'Reply with JSON only: {"messages": [{"from": "<first name>", "text": "..."}]}';

/** The writer's facts, as the prompt says them. */
export function chatPrompt(f: ChatFacts): string {
  const lines = [`The cast (only these people are in the chat): ${f.cast.map((c) => `${shortName(c.name)} — ${c.bio.slice(0, 90)}`).join("; ")}.`];
  lines.push(`What aired yesterday${f.code ? ` (${f.code})` : ""}:`);
  for (const d of f.dates) lines.push(`- ${shortName(d.a_name)} and ${shortName(d.b_name)}'s ${dateLabel(d.date_number ?? 1).toLowerCase()}${d.venue ? ` at ${venuePhrase(d.venue)}` : ""}: ${endedWords(d)}.`);
  if (f.dare) lines.push(`- The audience dared ${f.dare.name} to ${lowerFirst(f.dare.text)} They ${f.dare.outcome}.`);
  if (f.recoupling) lines.push(`- The Recoupling night played. The audience voted on ${f.recoupling.ask}${f.recoupling.winner ? `: ${f.recoupling.winner}` : ""}.`);
  for (const s of f.secrets) lines.push(`- A secret came out: ${s.name} ${lowerFirst(s.secret)}`);
  lines.push("Write the chat.");
  return lines.join("\n");
}

/** One message, checked: a cast member's, PG, English, short, giving away no hidden secret. Null when it fails. */
export function checkChatLine(raw: { from?: unknown; text?: unknown }, cast: readonly CastMember[], hidden: readonly string[]): ChatLine | null {
  if (typeof raw.from !== "string" || typeof raw.text !== "string") return null;
  const who = raw.from.trim().toLowerCase();
  const member = cast.find((c) => shortName(c.name).toLowerCase() === who || c.name.toLowerCase() === who);
  if (!member) return null;
  const text = raw.text.replace(/\s+/g, " ").trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (text.length < 2 || text.length > CHAT_LINE_MAX) return null;
  if (!checkSheetText({ text }).ok || !checkShowText({ text }).ok) return null;
  if (needsTranslation(text)) return null;
  if (hidden.some((s) => slipped(text, s))) return null;
  return { character_id: member.id, text };
}

/** The model's chat, checked line by line; null when the call fails or fewer than CHAT_MIN messages pass. */
export async function writeChat(model: Model, f: ChatFacts, hidden: readonly string[]): Promise<ChatLine[] | null> {
  let raw: string;
  try {
    raw = await model.complete(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: chatPrompt(f) },
      ],
      { temperature: 0.9, maxTokens: 1200 },
    );
  } catch {
    return null;
  }
  const body = raw.trim();
  let parsed: unknown;
  try {
    parsed = (JSON.parse(CODE_FENCE.exec(body)?.[1] ?? body) as { messages?: unknown }).messages;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const lines = parsed
    .slice(0, CHAT_MAX + 2)
    .map((m) => (m && typeof m === "object" ? checkChatLine(m as { from?: unknown; text?: unknown }, f.cast, hidden) : null))
    .filter((l): l is ChatLine => l !== null)
    .slice(0, CHAT_MAX);
  if (lines.length < CHAT_MIN || new Set(lines.map((l) => l.character_id)).size < 2) return null;
  return lines;
}

/** The $0 chat from the same facts: a few lines in the show's voice, speakers dealt from the cast by the day. */
export function templateChat(f: ChatFacts): ChatLine[] {
  if (f.cast.length < 2) return [];
  const out: ChatLine[] = [];
  // Whoever spoke last doesn't speak again straight away (a chat, not a monologue).
  const pick = (salt: string, not: readonly string[] = []) => {
    const last = out[out.length - 1]?.character_id;
    const pool = f.cast.filter((c) => !not.includes(c.id) && c.id !== last);
    const from = pool.length ? pool : f.cast;
    return from[seedFrom("cast-chat", f.day, salt) % from.length];
  };
  const say = (c: CastMember, text: string) => out.push({ character_id: c.id, text });
  for (const [i, d] of f.dates.slice(0, 2).entries()) {
    const who = pick(`date-${i}`, [d.a, d.b]);
    const a = shortName(d.a_name);
    const b = shortName(d.b_name);
    if (d.ending === "second_date")
      say(who, (d.date_number ?? 1) > 1 ? `${a} and ${b} again. I'm not saying I called it. I'm saying I called it.` : `${a} and ${b} want a second date. I'm not saying I called it. I'm saying I called it.`);
    else if (d.ending === "friends") say(who, `${a} and ${b}: friends. The goodbye hug said everything.`);
    else say(who, `Nobody mention ${d.venue ? venuePhrase(d.venue) : "last night"} to ${a} or ${b} for a while.`);
    const inIt = f.cast.find((c) => c.id === d.a || c.id === d.b);
    if (inIt && i === 0 && inIt.id !== who.id) say(inIt, d.ending === "disaster" ? "I can see you all typing." : "No comment. Okay, one comment: it was nice.");
  }
  if (f.dare) {
    const who = pick("dare");
    say(who, f.dare.outcome === "went through with it" ? `${f.dare.name} actually did the dare. Respect.` : f.dare.outcome === "chickened out" ? `${f.dare.name} had one job.` : `${f.dare.name} half did the dare. I'll allow it.`);
  }
  if (f.recoupling) say(pick("recoupling"), `Recoupling night. Nobody in this chat slept${f.recoupling.winner ? `, least of all ${f.recoupling.winner}` : ""}.`);
  for (const s of f.secrets.slice(0, 1)) say(pick(`secret-${s.name}`), `Wait. ${s.name} ${lowerFirst(s.secret).replace(/\.$/, "")}?`);
  if (out.length < CHAT_MIN) say(pick("close"), "Same time tomorrow. Bring snacks.");
  return out.slice(0, CHAT_MAX).filter((l) => checkSheetText({ text: l.text }).ok && checkShowText({ text: l.text }).ok);
}

export type CastChatWritten = { day: string; source: "model" | "template"; lines: number } | { day: string; skipped: "already" | "quiet" | "no_cast" };

/** The UTC day before `now`: the day a chat written now is about. */
export const chatDayOf = (now: Date): string => new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10);

/**
 * The hourly lobby job's part: writes yesterday's chat once. Claims the day's row first (two passes can't both call the
 * model), then fills it; a quiet day keeps an empty row so the job doesn't ask again.
 */
export async function ensureCastChat(db: Db, now: Date = new Date(), opts: { model?: Model } = {}): Promise<CastChatWritten> {
  const day = chatDayOf(now);
  const claimed = await db.query(`insert into cast_chats (day, lines, source) values ($1, '[]'::jsonb, 'pending') on conflict (day) do nothing returning day`, [day]);
  if (!claimed.rows.length) return { day, skipped: "already" };
  const facts = await chatFacts(db, day, now);
  if (facts.cast.length < 2) {
    await db.query(`update cast_chats set source = 'quiet' where day = $1`, [day]);
    return { day, skipped: "no_cast" };
  }
  if (!hasNews(facts)) {
    await db.query(`update cast_chats set source = 'quiet' where day = $1`, [day]);
    return { day, skipped: "quiet" };
  }
  const hidden = (await Promise.all(facts.cast.map((c) => hiddenCastSecrets(db, c.id, asOfDay(day, now)).catch(() => [] as string[])))).flat();
  const model = opts.model ?? (voiceEnabled ? getModel(undefined, false) : null);
  const written = model ? await writeChat(model, facts, hidden) : null;
  const lines = written ?? templateChat(facts).filter((l) => !hidden.some((s) => slipped(l.text, s)));
  const source = written ? "model" : "template";
  await db.query(`update cast_chats set lines = $2::jsonb, source = $3, written_at = now() where day = $1`, [day, JSON.stringify(lines), source]);
  return { day, source, lines: lines.length };
}

export type CastChatLineView = { character_id: string; name: string; hue: number | null; portrait: string | null; text: string };
export type CastChat = {
  day: string;
  /** "S2 · Night 1": the night it's about. */
  code: string | null;
  written_at: string;
  lines: CastChatLineView[];
};

/** The newest chat with lines, if it's from the last CHAT_SHOWN_DAYS: /watch's card and Since you were here. */
export async function latestCastChat(db: Db, now: Date = new Date()): Promise<CastChat | null> {
  const row = (
    await db.query<{ day: string; lines: ChatLine[]; written_at: Date | string }>(
      `select day, lines, written_at from cast_chats
        where source in ('model', 'template') and jsonb_array_length(lines) > 0 and day >= $1
        order by day desc limit 1`,
      [new Date(now.getTime() - (CHAT_SHOWN_DAYS + 1) * DAY_MS).toISOString().slice(0, 10)],
    )
  ).rows[0];
  if (!row) return null;
  const ids = [...new Set(row.lines.map((l) => l.character_id))];
  const chars = await db.query<{ id: string; name: string; hue: number | null; portrait: string | null; visibility: string }>(
    `select c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait, c.visibility from characters c where c.id = any($1)`,
    [ids],
  );
  const byId = new Map(chars.rows.map((c) => [c.id, c]));
  // A cast member who went private since stays out of it.
  const lines = row.lines.flatMap((l) => {
    const c = byId.get(l.character_id);
    return c && c.visibility === "public" ? [{ character_id: c.id, name: shortName(c.name), hue: c.hue, portrait: c.portrait, text: l.text }] : [];
  });
  if (!lines.length) return null;
  return { day: row.day, code: episodeCode(dayStart(row.day)), written_at: new Date(row.written_at).toISOString(), lines };
}
