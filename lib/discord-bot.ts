/**
 * The /date bot (docs/discord.md "The /date bot"; Dave's plan, 2026-11-20): the communities that convert for Botchelor
 * take down link posts, so the show goes to them. In an OC or roleplay server a member types `/date` with a sentence
 * about their character; the bot drafts the character exactly as the site's one-sentence create does, sends it on a
 * speed date with one of this season's house cast (the newcomer's first date: lib/first-date.ts), and posts it in that
 * channel with three buttons to call the ending. The server calls it; at the reveal the bot posts the ending, two lines
 * from the date, who called it right and one link to the date on botchelor.com. `/leaderboard` is this server's best
 * callers this month.
 *
 * Safeguards (Dave agreed them; none is a setting):
 *  1. No server messages: interactions only (lib/discord-interactions.ts). The one thing a member typed that is kept is
 *     their /date sentence, which becomes their character's sheet through the site's own draft and screen
 *     (lib/express-create.ts) and nothing more. Calls keep the display name the caller had then, for the board.
 *  2. 18+: a member's first /date answers, only to them, with one button ("I'm 18 or older, and this is my own fictional
 *     adult character", the builder's box). discord_members keeps their Discord id, when they pressed it, and the show's
 *     identity made for them (a random id, like a signed-out visitor's). No date runs without it.
 *  3. PG only: the sentence meets screenExpressText before any model reads it, the draft meets the import reader's
 *     screen and the adult-age rule, the save meets the character route's checks, the booking route's rules hold (one
 *     date at a time, this week's free dates, the paid-model cap, the pause), and nothing of After Dark is ever read or
 *     offered. A sentence refused for going past PG gets the rule, never After Dark. On After Dark's host it's all off.
 *  4. Never a ping, never the token: every body carries allowed_mentions: { parse: [] }; names and lines are escaped.
 *
 * Caps on top of the site's: DISCORD_BOT_DAILY_DATES_PER_GUILD (20) and DISCORD_BOT_DAILY_DATES_PER_USER (3) a UTC day,
 * claimed in discord_dates before any work and given back when no date came of it. The date is unlisted on the site
 * (by link, not the feed or the digests), and spends one of the member's free dates like any first date.
 */
import { after } from "next/server";
import { POST as postCharacter } from "@/app/api/characters/route";
import { POST as postEpisode } from "@/app/api/episodes/route";
import { airEpisode } from "./air";
import { generationPaused, PAUSED_MESSAGE } from "./compute";
import type { Db } from "./db";
import { clipText, discordTime, escapeDiscord, type DiscordEmbed } from "./discord";
import {
  deferredEphemeral,
  INTERACTION,
  interactionClient,
  replyWith,
  RESPONSE,
  TOKEN_LIFETIME_MS,
  updateWith,
  type BotButton,
  type BotMessage,
  type BotRow,
  type InteractionClient,
} from "./discord-interactions";
import { draftFromReading, EXPRESS_TEXT_MAX, EXPRESS_TEXT_MIN, expressFailureLine, fieldsFromReply, screenExpressText, type ExpressFailure } from "./express-create";
import { askExpressModel, freeExpressName } from "./express-draft";
import { normaliseExtras } from "./extras";
import { firstDateFormat, pickFirstPartner } from "./first-date";
import { USER_COOKIE } from "./http";
import { EXPRESS_DRAFT_ALL_LIMITS, EXPRESS_DRAFT_LIMITS, overLimit } from "./limits";
import { fillProfile } from "./profile-fill";
import { ENDING_LABELS, ENDINGS, PRONOUNS, REPORT_HIDE_THRESHOLD, type Ending } from "./rules";
import { seasonCastCards } from "./season-cast";
import { siteUrl } from "./site";
import { venuePhrase } from "./venues";

type Env = Record<string, string | undefined>;

export const DEFAULT_DATES_PER_GUILD = 20;
export const DEFAULT_DATES_PER_USER = 3;
/** Calls stay open at least this long after a date is booked (DISCORD_BOT_CALL_WINDOW_SECONDS), and close at the reveal. */
export const DEFAULT_CALL_WINDOW_SECONDS = 120;
/** The bot stops using a /date's interaction token this long after the command (Discord honours it for 15 minutes). */
export const WORK_BUDGET_MS = TOKEN_LIFETIME_MS - 2 * 60 * 1000;
/** How often the bot looks whether the date has finished filming. */
export const POLL_MS = 3_000;
/** The board's length. */
export const BOARD_SIZE = 10;
/** The button an unattested member presses: the builder's 18+ box, in the same words. */
export const ATTEST_LABEL = "I'm 18 or older, and this is my own fictional adult character";
const DISPLAY_NAME_MAX = 32;

const intEnv = (raw: string | undefined, fallback: number, max: number): number => {
  const n = Number(raw?.trim() || NaN);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), max) : fallback;
};
export const datesPerGuild = (env: Env = process.env) => intEnv(env.DISCORD_BOT_DAILY_DATES_PER_GUILD, DEFAULT_DATES_PER_GUILD, 1000);
export const datesPerUser = (env: Env = process.env) => intEnv(env.DISCORD_BOT_DAILY_DATES_PER_USER, DEFAULT_DATES_PER_USER, 100);
export const callWindowSeconds = (env: Env = process.env) => intEnv(env.DISCORD_BOT_CALL_WINDOW_SECONDS, DEFAULT_CALL_WINDOW_SECONDS, 24 * 60 * 60);

/* ------------------------------------------------ the payload ------------------------------------------------ */

type DiscordUser = { id: string; username?: string; global_name?: string | null; bot?: boolean };
export type Interaction = {
  id?: string;
  application_id?: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  member?: { user?: DiscordUser; nick?: string | null };
  user?: DiscordUser;
  data?: { name?: string; options?: { name: string; type?: number; value?: unknown }[]; custom_id?: string };
};

/** Who did it: their Discord id, and the name this server shows for them (nick, else global name, else username). */
function actorOf(i: Interaction): { id: string; name: string } | null {
  const u = i.member?.user ?? i.user;
  if (!u || typeof u.id !== "string" || !/^\d{5,30}$/.test(u.id) || u.bot) return null;
  const name = (i.member?.nick || u.global_name || u.username || "A member").replace(/\s+/g, " ").trim();
  return { id: u.id, name: name.slice(0, DISPLAY_NAME_MAX) || "A member" };
}

/* ------------------------------------------------ the context ------------------------------------------------ */

export type BotContext = {
  db: Db;
  env: Env;
  client: InteractionClient;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** The site's address, for links and for the in-process calls to its own routes. */
  base: string;
};

export function botContext(db: Db, appId: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): BotContext {
  return { db, env, client: interactionClient(appId, fetchImpl), now: () => new Date(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), base: siteUrl(env) };
}

/** What the route answers Discord with now, and any work to do after the answer has gone. */
export type Handled = { response: Record<string, unknown>; work?: () => Promise<void> };

let afterForTests: ((work: () => Promise<void>) => void) | null = null;
/** Tests collect the after-the-answer work and await it themselves (there's no request scope for after()). */
export function setDiscordAfterForTests(fn: ((work: () => Promise<void>) => void) | null): void {
  afterForTests = fn;
}
/** Runs work after the response has gone (next/server after()). The work never throws. */
export function afterResponse(work: () => Promise<void>): void {
  const safe = () => work().catch((err: unknown) => console.error(`[discord-bot] work failed: ${err instanceof Error ? err.name : "unknown"}`));
  if (afterForTests) return afterForTests(safe);
  after(safe);
}

const ephemeral = (content: string): Handled => ({ response: replyWith({ content, ephemeral: true }) });

/* ------------------------------------------------ the door ------------------------------------------------ */

/** One interaction, already verified as Discord's. */
export async function handleInteraction(ctx: BotContext, i: Interaction): Promise<Handled> {
  if (i.type === INTERACTION.ping) return { response: { type: RESPONSE.pong } };
  if (i.type === INTERACTION.command) {
    if (i.data?.name === "date") return dateCommand(ctx, i);
    if (i.data?.name === "leaderboard") return leaderboardCommand(ctx, i);
    return ephemeral("The show doesn't know that command.");
  }
  if (i.type === INTERACTION.component) {
    const id = i.data?.custom_id ?? "";
    if (id === "bz:attest") return attest(ctx, i);
    const call = /^bz:call:([A-Za-z0-9-]{1,64}):([a-z_]{1,20})$/.exec(id);
    if (call && (ENDINGS as readonly string[]).includes(call[2])) return callEnding(ctx, i, call[1], call[2] as Ending);
    const reveal = /^bz:reveal:([A-Za-z0-9-]{1,64})$/.exec(id);
    if (reveal) return revealPressed(ctx, i, reveal[1]);
    return ephemeral("That button has expired.");
  }
  return { response: { type: RESPONSE.pong } };
}

/* ------------------------------------------------ 18+ ------------------------------------------------ */

const attestPrompt = (): Handled => ({
  response: replyWith({
    ephemeral: true,
    content:
      "Before your first date: Botchelor is for adults, and every character on it is a fictional adult you made up. " +
      "Confirm below, then run /date again. Only that you confirmed, and when, is kept.",
    components: [{ type: 1, components: [{ type: 2, style: 1, label: ATTEST_LABEL, custom_id: "bz:attest" }] }],
  }),
});

async function attest(ctx: BotContext, i: Interaction): Promise<Handled> {
  const who = actorOf(i);
  if (!who) return ephemeral("Only a member can confirm.");
  await ctx.db.query(
    `insert into discord_members (discord_id, owner_id, attested_at) values ($1, $2, $3)
     on conflict (discord_id) do update set attested_at = coalesce(discord_members.attested_at, excluded.attested_at)`,
    [who.id, crypto.randomUUID(), ctx.now().toISOString()],
  );
  return { response: updateWith({ content: "Thanks, you're confirmed. Run /date again with a sentence about your character.", components: [] }) };
}

/* ------------------------------------------------ /date ------------------------------------------------ */

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * The sentence for a failure, said only to the member. A refusal by the show's rules is the rule (the site's own
 * sentence); everything else says what happened, without the site's "here's the form" (there's no form here).
 */
export function discordFailureLine(reason: ExpressFailure | "nobody" | "booking", serverMessage?: string | null): string {
  switch (reason) {
    case "minor":
    case "real_person":
    case "unsafe":
      return expressFailureLine(reason, serverMessage);
    case "limited":
      return "That's a lot of drafts for one day. Try again tomorrow, or make them on botchelor.com.";
    case "timeout":
      return "The draft took too long. Try /date again in a minute.";
    case "unreadable":
      return "We couldn't find a character in that. Try a sentence about who they are and what they do.";
    case "nobody":
      return "There's nobody on this season's cast free for a date right now. Try again later.";
    case "booking":
      return serverMessage?.trim() || "The date couldn't be booked just now. Try /date again in a minute.";
    default:
      return "The show's writer couldn't draft them just now. Try /date again in a minute.";
  }
}

async function dateCommand(ctx: BotContext, i: Interaction): Promise<Handled> {
  if (!i.guild_id) return ephemeral("/date works in a server, where everyone can call the ending.");
  const who = actorOf(i);
  if (!who) return ephemeral("Only a member can send a character on a date.");
  const raw = i.data?.options?.find((o) => o.name === "description")?.value;
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (text.length < EXPRESS_TEXT_MIN || text.length > EXPRESS_TEXT_MAX) {
    return ephemeral(`Describe your character in a sentence or two (${EXPRESS_TEXT_MIN} to ${EXPRESS_TEXT_MAX} characters).`);
  }
  const member = (await ctx.db.query<{ owner_id: string; attested_at: Date | string | null }>(`select owner_id, attested_at from discord_members where discord_id = $1`, [who.id])).rows[0];
  if (!member?.attested_at) return attestPrompt();
  if (generationPaused(ctx.env)) return ephemeral(PAUSED_MESSAGE);
  // The site's own check on the words, before anything is spent: a minor, a real person, anything past PG.
  const screened = screenExpressText(text, "");
  if (!screened.ok) return ephemeral(discordFailureLine(screened.reason, screened.message));

  const now = ctx.now();
  const guildCap = datesPerGuild(ctx.env);
  const userCap = datesPerUser(ctx.env);
  const slot = crypto.randomUUID();
  const claimed = await ctx.db.query(
    `insert into discord_dates (id, guild_id, discord_id, created_at)
     select $1, $2, $3, $4
      where (select count(*) from discord_dates where guild_id = $2 and created_at >= $5) < $6
        and (select count(*) from discord_dates where discord_id = $3 and created_at >= $5) < $7
     returning id`,
    [slot, i.guild_id, who.id, now.toISOString(), startOfUtcDay(now).toISOString(), guildCap, userCap],
  );
  if (!claimed.rows.length) {
    const used = (await ctx.db.query<{ n: number }>(`select count(*)::int as n from discord_dates where guild_id = $1 and created_at >= $2`, [i.guild_id, startOfUtcDay(now).toISOString()])).rows[0]?.n ?? 0;
    return ephemeral(
      used >= guildCap
        ? `This server has had its ${guildCap} dates for today. More at midnight UTC, or watch them all on botchelor.com.`
        : `That's your ${userCap} dates for today. More at midnight UTC.`,
    );
  }
  const job: DateJob = { slot, token: i.token, ownerId: member.owner_id, discordId: who.id, guildId: i.guild_id, text, startedAt: now };
  return { response: deferredEphemeral(), work: () => runDate(ctx, job) };
}

type DateJob = { slot: string; token: string; ownerId: string; discordId: string; guildId: string; text: string; startedAt: Date };

/** A route of the site's, called in-process as the member's identity (the way the house books life dates). */
async function asOwner(ctx: BotContext, path: string, ownerId: string, body: unknown, route: (req: Request) => Promise<Response>) {
  const req = new Request(new URL(path, ctx.base), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${USER_COOKIE}=${ownerId}` },
    body: JSON.stringify(body),
  });
  const res = await route(req);
  return { status: res.status, data: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
}

/** Everything after the "thinking…": draft, save, book, post, wait for the cameras, reveal. Never throws. */
export async function runDate(ctx: BotContext, job: DateJob): Promise<void> {
  const fail = async (reason: Parameters<typeof discordFailureLine>[0], message?: string | null) => {
    // No date came of it: the slot goes back, and only the member hears why.
    await ctx.db.query(`delete from discord_dates where id = $1 and episode_id is null`, [job.slot]).catch(() => {});
    await ctx.client.editOriginal(job.token, { content: discordFailureLine(reason, message) });
  };
  try {
    const { db } = ctx;
    const limited =
      (await overLimit(db, "express_draft_user", job.ownerId, EXPRESS_DRAFT_LIMITS)) || (await overLimit(db, "express_draft_all", "all", EXPRESS_DRAFT_ALL_LIMITS));
    if (limited) return await fail("limited");
    const raw = await askExpressModel(job.text);
    if (raw === "timeout") return await fail("timeout");
    const reading = raw === null ? null : fieldsFromReply(raw);
    if (!reading) return await fail("model");
    const drafted = draftFromReading(reading, job.text, "");
    if (!drafted.ok) return await fail(drafted.reason, drafted.message);
    const { draft } = drafted;
    let name = await freeExpressName(db, draft.sheet.name, job.text);
    if (!name) return await fail("unreadable");

    // The builder's save, as the builder sends it for a first character (its empty dating profile filled from the sheet).
    const traits = draft.traits.map((t) => t.trim());
    const extras = fillProfile(normaliseExtras(draft.extras), { traits, want: draft.sheet.want.trim() });
    const sheet = (n: string) => ({
      name: n,
      age: Number(draft.sheet.age),
      bio: draft.sheet.bio.trim(),
      traits,
      want: draft.sheet.want.trim(),
      dealbreaker: draft.sheet.dealbreaker.trim(),
      ...(draft.appearance.trim() ? { appearance: draft.appearance.trim() } : {}),
      ...((PRONOUNS as readonly string[]).includes(draft.pronouns) ? { pronouns: draft.pronouns } : {}),
      ...(draft.voice.trim() ? { voice: draft.voice.trim() } : {}),
      ...(Object.keys(extras).length ? { extras } : {}),
      attest: true,
    });
    let saved = await asOwner(ctx, "/api/characters", job.ownerId, sheet(name), postCharacter);
    if (saved.status === 409 && Array.isArray(saved.data.free_names) && typeof saved.data.free_names[0] === "string") {
      name = saved.data.free_names[0];
      saved = await asOwner(ctx, "/api/characters", job.ownerId, sheet(name), postCharacter);
    }
    if (saved.status !== 201 || typeof saved.data.id !== "string") {
      return await fail(saved.data.error === "content_rejected" ? "unsafe" : "model", typeof saved.data.message === "string" ? saved.data.message : null);
    }
    const characterId = saved.data.id;

    const cast = (await seasonCastCards(db, ctx.now())).map((c) => ({ id: c.id, name: c.name }));
    const partner = pickFirstPartner(cast, characterId);
    if (!partner) return await fail("nobody");
    const booked = await asOwner(
      ctx,
      "/api/episodes",
      job.ownerId,
      { character_id: characterId, partner_id: partner.id, format: firstDateFormat(ctx.env), visibility: "unlisted" },
      postEpisode,
    );
    if (booked.status !== 200 || typeof booked.data.id !== "string") {
      const msg =
        booked.data.error === "episode_limit_reached"
          ? "Your characters have used this week's free dates. They come back Monday 00:00 UTC."
          : typeof booked.data.message === "string"
            ? booked.data.message
            : null;
      return await fail("booking", msg);
    }
    const episodeId = booked.data.id;
    const closeAt = new Date(ctx.now().getTime() + callWindowSeconds(ctx.env) * 1000);
    await db.query(`update discord_dates set episode_id = $2, calls_close_at = $3 where id = $1`, [job.slot, episodeId, closeAt.toISOString()]);

    await ctx.client.editOriginal(job.token, {
      content: `**${escapeDiscord(name)}**, ${escapeDiscord(draft.sheet.age)}: ${escapeDiscord(clipText(draft.sheet.bio, 300))}\nThey're on a date with ${escapeDiscord(partner.name)} in this channel. The server calls the ending.`,
    });
    const info = await dateInfo(db, episodeId);
    if (!info) return;
    const posted = await ctx.client.followUp(job.token, dateMessage(info, closeAt, true));
    if (posted.id) await db.query(`update discord_dates set message_id = $2 where id = $1`, [job.slot, posted.id]);

    // The cameras: in production the booking route writes the date after its own answer; wait for it here.
    const deadline = job.startedAt.getTime() + WORK_BUDGET_MS;
    for (;;) {
      const st = (await db.query<{ status: string }>(`select status from episodes where id = $1`, [episodeId])).rows[0]?.status;
      if (!st) {
        // A failed date is deleted and its free date given back (lib/jobs.ts): the slot goes back too.
        await db.query(`delete from discord_dates where id = $1`, [job.slot]);
        if (posted.id) await ctx.client.editMessage(job.token, posted.id, { content: "The cameras failed on this one: no date was spent. Try /date again.", components: [] });
        return;
      }
      if (st === "ready") break;
      if (ctx.now().getTime() + POLL_MS > deadline) return; // still filming: the Reveal button takes it from here
      await ctx.sleep(POLL_MS);
    }
    const wait = closeAt.getTime() - ctx.now().getTime();
    if (ctx.now().getTime() + Math.max(0, wait) > deadline) return; // calls outlast the token: the Reveal button does it
    if (wait > 0) await ctx.sleep(wait);
    const claimed = await claimReveal(db, episodeId, ctx.now());
    if (!claimed) return;
    if (posted.id) await ctx.client.editMessage(job.token, posted.id, dateMessage(info, closeAt, false));
    await airOnSite(db, episodeId);
    await ctx.client.followUp(job.token, await revealMessage(ctx, episodeId, claimed.guild_id));
  } catch (err) {
    console.error(`[discord-bot] /date failed: ${err instanceof Error ? err.name : "unknown"}`);
    await fail("model").catch(() => {});
  }
}

/* ------------------------------------------------ the date's message ------------------------------------------------ */

type DateInfo = { id: string; a: string; b: string; bio: string; venue: string | null };

async function dateInfo(db: Db, episodeId: string): Promise<DateInfo | null> {
  const row = (
    await db.query<{ id: string; a: string; b: string; bio: string; venue: string | null }>(
      `select e.id, ca.name as a, cb.name as b, ca.bio, e.setup->>'venue' as venue
         from episodes e join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b
        where e.id = $1`,
      [episodeId],
    )
  ).rows[0];
  return row ?? null;
}

/** Who's on the date, where, and the buttons: three calls and Reveal while it's open; none once it's revealed. */
export function dateMessage(info: DateInfo, closeAt: Date, open: boolean): BotMessage {
  const where = info.venue ? `Tonight at ${escapeDiscord(venuePhrase(info.venue))}.` : "";
  const embed: DiscordEmbed = {
    title: `🌹 ${info.a} × ${info.b}`,
    description: [escapeDiscord(clipText(info.bio, 300)), where].filter(Boolean).join("\n\n"),
    fields: [
      open
        ? { name: "How does it end?", value: `Call it below. Calls close at the reveal, ${discordTime(closeAt, "R")} at the earliest.` }
        : { name: "Calls are closed", value: "The ending is out: see the reveal below." },
    ],
    footer: { text: "A speed date on Botchelor. The characters decide how it ends." },
  };
  const calls: BotButton[] = ENDINGS.map((e) => ({ type: 2, style: 2, label: ENDING_LABELS[e], custom_id: `bz:call:${info.id}:${e}` }));
  const components: BotRow[] = open
    ? [
        { type: 1, components: calls },
        { type: 1, components: [{ type: 2, style: 1, label: "Reveal the ending", custom_id: `bz:reveal:${info.id}` }] },
      ]
    : [];
  return { embeds: [{ ...embed, title: escapeDiscord(embed.title!) }], components };
}

/* ------------------------------------------------ calls ------------------------------------------------ */

async function callEnding(ctx: BotContext, i: Interaction, episodeId: string, pick: Ending): Promise<Handled> {
  const who = actorOf(i);
  if (!who || !i.guild_id) return ephemeral("Calls are for members of the server the date is in.");
  const saved = await ctx.db.query<{ pick: Ending }>(
    `insert into discord_calls (guild_id, episode_id, discord_id, display_name, pick)
     select d.guild_id, d.episode_id, $3, $4, $5
       from discord_dates d join episodes e on e.id = d.episode_id
      where d.episode_id = $1 and d.guild_id = $2 and d.revealed_at is null and e.revealed_at is null and d.discord_id <> $3
     on conflict (guild_id, episode_id, discord_id) do update set pick = excluded.pick, display_name = excluded.display_name, updated_at = now()
     returning pick`,
    [episodeId, i.guild_id, who.id, who.name, pick],
  );
  if (saved.rows[0]) return ephemeral(`Your call: **${ENDING_LABELS[saved.rows[0].pick]}**. You can change it until the reveal.`);
  const d = (await ctx.db.query<{ discord_id: string }>(`select discord_id from discord_dates where episode_id = $1 and guild_id = $2`, [episodeId, i.guild_id])).rows[0];
  if (!d) return ephemeral("That date isn't from this server.");
  if (d.discord_id === who.id) return ephemeral("It's your character's date: let the server call it.");
  return ephemeral("Calls are closed: the ending is out.");
}

/* ------------------------------------------------ the reveal ------------------------------------------------ */

/** Takes the reveal, once: the date is filmed, its calls have had their window (or the site already aired it), not pulled by reports. */
export async function claimReveal(db: Db, episodeId: string, now: Date): Promise<{ guild_id: string } | null> {
  const { rows } = await db.query<{ guild_id: string }>(
    `update discord_dates d set revealed_at = $2
       from episodes e
      where d.episode_id = $1 and e.id = d.episode_id and d.revealed_at is null and e.status = 'ready'
        and (d.calls_close_at <= $2 or e.revealed_at is not null)
        and (select count(*) from reports r where r.episode_id = e.id) < $3
     returning d.guild_id`,
    [episodeId, now.toISOString(), REPORT_HIDE_THRESHOLD],
  );
  return rows[0] ?? null;
}

/** The site airs it too (lib/air.ts, as its host would), so its page shows the ending; already aired is fine. */
async function airOnSite(db: Db, episodeId: string): Promise<void> {
  const host = (await db.query<{ creator_id: string }>(`select creator_id from episodes where id = $1`, [episodeId])).rows[0]?.creator_id;
  if (host) await airEpisode(db, episodeId, host, { airedBy: host }).catch(() => null);
}

/** The date's page on the site, tagged so the engagement log counts the visits the bot brings. */
export function episodeLink(base: string, episodeId: string): string {
  const url = new URL(`/episodes/${encodeURIComponent(episodeId)}`, base);
  url.searchParams.set("utm_source", "discord");
  url.searchParams.set("utm_medium", "bot");
  url.searchParams.set("utm_campaign", "date");
  return url.toString();
}

type Turn = { side?: string; dialogue?: string };

export async function revealMessage(ctx: BotContext, episodeId: string, guildId: string): Promise<BotMessage> {
  const ep = (
    await ctx.db.query<{ ending: Ending; best_line: string | null; transcript: Turn[] | null; a: string; b: string }>(
      `select e.ending, e.best_line, e.transcript, ca.name as a, cb.name as b
         from episodes e join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b
        where e.id = $1`,
      [episodeId],
    )
  ).rows[0];
  const calls = (await ctx.db.query<{ display_name: string; pick: Ending }>(`select display_name, pick from discord_calls where guild_id = $1 and episode_id = $2 order by created_at`, [guildId, episodeId])).rows;
  const link = episodeLink(ctx.base, episodeId);
  if (!ep) return { content: "This date isn't on the show any more." };
  const first = (n: string) => n.trim().split(/\s+/)[0] || n;
  // Two lines from the date: the last two it ended on, else its best line.
  const said = (Array.isArray(ep.transcript) ? ep.transcript : [])
    .filter((t) => typeof t.dialogue === "string" && t.dialogue.trim())
    .slice(-2)
    .map((t) => `**${escapeDiscord(first(t.side === "b" ? ep.b : ep.a))}:** “${escapeDiscord(clipText(t.dialogue!, 180))}”`);
  if (!said.length && ep.best_line?.trim()) said.push(`“${escapeDiscord(clipText(ep.best_line, 200))}”`);
  const right = calls.filter((c) => c.pick === ep.ending).map((c) => escapeDiscord(c.display_name));
  const shown = right.slice(0, 10).join(", ") + (right.length > 10 ? ` and ${right.length - 10} more` : "");
  const tally = calls.length
    ? right.length
      ? `${shown} (${right.length} of ${calls.length} calls)`
      : `Nobody: 0 of ${calls.length} calls.`
    : "Nobody called this one.";
  return {
    content: `🔓 **${escapeDiscord(ep.a)} × ${escapeDiscord(ep.b)}**: ${ENDING_LABELS[ep.ending]}.`,
    embeds: [
      {
        title: escapeDiscord(`${ep.a} × ${ep.b}: ${ENDING_LABELS[ep.ending]}`),
        url: link,
        description: said.join("\n") || undefined,
        fields: [{ name: "Called it", value: tally }],
        footer: { text: "The whole date, every line, is on Botchelor." },
      },
    ],
    components: [{ type: 1, components: [{ type: 2, style: 5, label: "Watch the full date", url: link }] }],
  };
}

async function revealPressed(ctx: BotContext, i: Interaction, episodeId: string): Promise<Handled> {
  if (!i.guild_id) return ephemeral("That date isn't from here.");
  const row = (
    await ctx.db.query<{ guild_id: string; status: string; d_revealed: boolean; e_revealed: boolean; calls_close_at: Date | string | null }>(
      `select d.guild_id, e.status, d.revealed_at is not null as d_revealed, e.revealed_at is not null as e_revealed, d.calls_close_at
         from discord_dates d join episodes e on e.id = d.episode_id where d.episode_id = $1`,
      [episodeId],
    )
  ).rows[0];
  if (!row || row.guild_id !== i.guild_id) return ephemeral("That date isn't from this server.");
  if (row.d_revealed) return ephemeral(`It's out already: ${episodeLink(ctx.base, episodeId)}`);
  if (row.status !== "ready") return ephemeral("They're still being filmed. Try again in a minute.");
  const closes = row.calls_close_at ? new Date(row.calls_close_at) : null;
  if (!row.e_revealed && closes && closes.getTime() > ctx.now().getTime()) return ephemeral(`Calls are open until ${discordTime(closes, "R")}. Get yours in!`);
  const claimed = await claimReveal(ctx.db, episodeId, ctx.now());
  if (!claimed) return ephemeral("This date can't be revealed here.");
  const info = await dateInfo(ctx.db, episodeId);
  const token = i.token;
  return {
    // The date's message closes (its buttons go), and the reveal follows it.
    response: info ? updateWith(dateMessage(info, closes ?? ctx.now(), false)) : deferredEphemeral(),
    work: async () => {
      await airOnSite(ctx.db, episodeId);
      await ctx.client.followUp(token, await revealMessage(ctx, episodeId, claimed.guild_id));
    },
  };
}

/* ------------------------------------------------ /leaderboard ------------------------------------------------ */

export type BoardRow = { discord_id: string; name: string; right: number; calls: number };

/** This server's best callers in a UTC month: right calls on dates revealed that month, at least one right. */
export async function guildBoard(db: Db, guildId: string, now: Date = new Date(), limit = BOARD_SIZE): Promise<BoardRow[]> {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const { rows } = await db.query<BoardRow>(
    `select c.discord_id,
            (array_agg(c.display_name order by c.updated_at desc))[1] as name,
            count(*) filter (where c.pick = e.ending)::int as right,
            count(*)::int as calls
       from discord_calls c
       join discord_dates d on d.episode_id = c.episode_id and d.guild_id = c.guild_id
       join episodes e on e.id = c.episode_id
      where c.guild_id = $1 and d.revealed_at >= $2 and d.revealed_at < $3
      group by c.discord_id
     having count(*) filter (where c.pick = e.ending) > 0
      order by 3 desc, 4 asc, 2 asc
      limit $4`,
    [guildId, from.toISOString(), to.toISOString(), limit],
  );
  return rows;
}

async function leaderboardCommand(ctx: BotContext, i: Interaction): Promise<Handled> {
  if (!i.guild_id) return ephemeral("/leaderboard is a server's own board: run it in a server.");
  const now = ctx.now();
  const rows = await guildBoard(ctx.db, i.guild_id, now);
  const month = now.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const lines = rows.map((r, n) => `${n + 1}. ${escapeDiscord(r.name)}: ${r.right} of ${r.calls}`);
  return {
    response: replyWith({
      embeds: [
        {
          title: `🏆 This server's best callers, ${month}`,
          description: lines.length ? lines.join("\n") : "No right calls yet this month. Run /date and call the ending.",
          footer: { text: "Right calls on dates revealed in this server this month (UTC)." },
        },
      ],
    }),
  };
}
