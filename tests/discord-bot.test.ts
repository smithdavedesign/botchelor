// The /date bot (lib/discord-bot.ts, lib/discord-interactions.ts, app/api/discord/interactions; docs/discord.md "The
// /date bot"): Discord's interactions endpoint only, signed requests only, 18+ asked once, PG only, never After Dark,
// never a ping, and the only calls out are to the interaction's own webhook (mocked here: no network).
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as interactions } from "@/app/api/discord/interactions/route";
import { botContext, claimReveal, guildBoard, handleInteraction, runDate, setDiscordAfterForTests, type BotContext, type Interaction } from "@/lib/discord-bot";
import { botBody, discordBotConfig, interactionClient, verifyDiscordRequest } from "@/lib/discord-interactions";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { episodeJson, scriptedModel, scriptOutcome, startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
let works: Promise<void>[] = [];
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  setDiscordAfterForTests(null);
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  for (const table of ["discord_calls", "discord_dates", "discord_members"]) await t.db.query(`delete from ${table}`);
  works = [];
  setDiscordAfterForTests((w) => void works.push(w()));
});
afterEach(() => {
  setSeasonCastForTests(HOUSE_CHARACTERS.map((c) => c.id));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const APP = "112233445566778899";
const GUILD = "998877665544332211";
const SITE = "https://botchelor.com";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const hexOf = (k: KeyObject) => Buffer.from(String(k.export({ format: "jwk" }).x), "base64url").toString("hex");
const PUBLIC_HEX = hexOf(publicKey);
const other = generateKeyPairSync("ed25519");
// Built from parts, so nothing here looks like a real interaction token.
const TOKEN = ["aW50", "ZXJh", "Y3Rpb24"].join("") + "x".repeat(40);

function turnOn() {
  vi.stubEnv("DISCORD_APP_ID", APP);
  vi.stubEnv("DISCORD_PUBLIC_KEY", PUBLIC_HEX);
  vi.stubEnv("SITE_URL", SITE);
}

function signed(body: unknown, opts: { key?: KeyObject; signature?: string | null; timestamp?: string } = {}): Request {
  const raw = JSON.stringify(body);
  const ts = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const sig = opts.signature === undefined ? sign(null, Buffer.from(ts + raw), opts.key ?? privateKey).toString("hex") : opts.signature;
  const headers: Record<string, string> = { "content-type": "application/json", "x-signature-timestamp": ts };
  if (sig !== null) headers["x-signature-ed25519"] = sig;
  return new Request(`${SITE}/api/discord/interactions`, { method: "POST", headers, body: raw });
}

const member = (id: string, nick: string | null = null, username = `user${id.slice(-3)}`) => ({ user: { id, username, global_name: null }, nick });
const ALICE = "100000000000000001";
const BOB = "100000000000000002";
const CARA = "100000000000000003";

const dateCmd = (who: string, description: string, guild: string | null = GUILD): Interaction => ({
  type: 2,
  application_id: APP,
  token: TOKEN,
  ...(guild ? { guild_id: guild, member: member(who, who === ALICE ? "Alice" : null) } : { user: { id: who, username: "dm" } }),
  data: { name: "date", options: [{ name: "description", type: 3, value: description }] },
});
const press = (who: string, customId: string, nick: string | null = null): Interaction => ({
  type: 3,
  application_id: APP,
  token: TOKEN,
  guild_id: GUILD,
  member: member(who, nick),
  data: { custom_id: customId },
});

type Sent = { method: string; url: string; body: Record<string, any> };
function fakeDiscord() {
  const sent: Sent[] = [];
  let n = 0;
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ method: String(init?.method), url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ id: String(500000000000000000n + BigInt(++n)) });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

/** The route with Discord's fetch swapped for the fake (the route builds its own context from the real fetch). */
async function post(body: unknown, fetchImpl: typeof fetch, opts: Parameters<typeof signed>[1] = {}) {
  vi.stubGlobal("fetch", fetchImpl);
  try {
    const res = await interactions(signed(body, opts));
    await Promise.all(works);
    works = [];
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  } finally {
    vi.unstubAllGlobals();
  }
}

/** The model's reading of a sentence, as the express draft asks for it. */
const reading = (o: Record<string, string> = {}) =>
  JSON.stringify({
    name: "Wren Halloway",
    age: "34",
    gender: "woman",
    description: "A night-shift baker who names every sourdough starter.",
    personality: "shy, precise, warm",
    wants: "someone who laughs at bread puns",
    dislikes: "people who are rude to waiters",
    occupation: "baker",
    likes: "",
    appearance: "",
    ...o,
  });

async function attested(who: string) {
  await t.db.query(`insert into discord_members (discord_id, owner_id, attested_at) values ($1, $2, now())`, [who, crypto.randomUUID()]);
}

/** Every body the bot sent or answered: never a ping. */
function expectNoPings(bodies: Record<string, any>[]) {
  expect(bodies.length).toBeGreaterThan(0);
  for (const b of bodies) expect(b.allowed_mentions).toEqual({ parse: [] });
}

describe("switching it on", () => {
  it("is off (404) until the app id and public key are set, and off on After Dark's host", async () => {
    const { fetchImpl } = fakeDiscord();
    expect((await post({ type: 1, token: TOKEN }, fetchImpl)).status).toBe(404);
    vi.stubEnv("DISCORD_APP_ID", APP);
    expect((await post({ type: 1, token: TOKEN }, fetchImpl)).status).toBe(404);
    vi.stubEnv("DISCORD_PUBLIC_KEY", "CHANGE_ME");
    expect((await post({ type: 1, token: TOKEN }, fetchImpl)).status).toBe(404);
    turnOn();
    expect((await post({ type: 1, token: TOKEN }, fetchImpl)).status).toBe(200);
    vi.stubEnv("AFTER_DARK_ONLY", "1");
    vi.stubEnv("AFTER_DARK_ORIGIN", "https://ad.botchelor.com");
    expect(discordBotConfig()).toBeNull();
    expect((await post({ type: 1, token: TOKEN }, fetchImpl)).status).toBe(404);
  });

  it("never reads the bot token: the server needs only the app id and the public key", () => {
    expect(discordBotConfig({ DISCORD_APP_ID: APP, DISCORD_PUBLIC_KEY: PUBLIC_HEX })).toEqual({ appId: APP, publicKey: PUBLIC_HEX });
    expect(discordBotConfig({ DISCORD_APP_ID: "not-a-snowflake", DISCORD_PUBLIC_KEY: PUBLIC_HEX })).toBeNull();
  });
});

describe("Discord's signature", () => {
  it("answers a signed PING with a PONG, and 401s a wrong, missing or stale signature", async () => {
    turnOn();
    const { fetchImpl, sent } = fakeDiscord();
    const ping = { type: 1, application_id: APP, token: TOKEN };
    expect(await post(ping, fetchImpl)).toEqual({ status: 200, body: { type: 1 } });
    expect((await post(ping, fetchImpl, { key: other.privateKey })).status).toBe(401);
    expect((await post(ping, fetchImpl, { signature: null })).status).toBe(401);
    expect((await post(ping, fetchImpl, { signature: "zz" })).status).toBe(401);
    expect((await post(ping, fetchImpl, { timestamp: String(Math.floor(Date.now() / 1000) - 3600) })).status).toBe(401);
    expect(sent).toEqual([]);
  });

  it("checks the exact bytes: a body changed after signing fails", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign(null, Buffer.from(`${ts}{"type":1}`), privateKey).toString("hex");
    expect(await verifyDiscordRequest(PUBLIC_HEX, sig, ts, `{"type":1}`)).toBe(true);
    expect(await verifyDiscordRequest(PUBLIC_HEX, sig, ts, `{"type": 1}`)).toBe(false);
    expect(await verifyDiscordRequest(PUBLIC_HEX, sig, null, `{"type":1}`)).toBe(false);
  });
});

describe("the 18+ gate", () => {
  it("a first /date asks only that member to confirm, keeps nothing but their id and the time, and runs no date", async () => {
    turnOn();
    const { fetchImpl, sent } = fakeDiscord();
    const first = await post(dateCmd(ALICE, "A night-shift baker who names every sourdough starter."), fetchImpl);
    expect(first.body.type).toBe(4);
    expect(first.body.data.flags).toBe(64);
    expect(first.body.data.components[0].components[0]).toMatchObject({ custom_id: "bz:attest", label: "I'm 18 or older, and this is my own fictional adult character" });
    expect(await t.count("discord_members" as never)).toBe(0);
    expect(await t.count("discord_dates" as never)).toBe(0);
    expect(await t.count("characters" as never, "owner_id is not null")).toBe(0);

    const ok = await post(press(ALICE, "bz:attest"), fetchImpl);
    expect(ok.body.type).toBe(7);
    const rows = (await t.db.query<Record<string, unknown>>(`select * from discord_members`)).rows;
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["attested_at", "created_at", "discord_id", "owner_id"]);
    expect(rows[0].discord_id).toBe(ALICE);
    expect(rows[0].owner_id).not.toBe(ALICE);
    expect(rows[0].attested_at).not.toBeNull();
    expectNoPings([first.body.data, ok.body.data]);
    expect(sent).toEqual([]);
  });

  it("refuses a minor or anything past PG before any model reads it, with the site's rule and never After Dark", async () => {
    turnOn();
    await attested(ALICE);
    const { calls } = scriptedModel([]);
    const { fetchImpl } = fakeDiscord();
    const minor = await post(dateCmd(ALICE, "A 16 year old skater who never stops talking."), fetchImpl);
    expect(minor.body.data.flags).toBe(64);
    expect(minor.body.data.content).toMatch(/18/);
    const racy = await post(dateCmd(ALICE, "A seductive stripper who loves explicit sex on the first date."), fetchImpl);
    expect(racy.body.data.flags).toBe(64);
    expect(racy.body.data.content).not.toMatch(/after dark/i);
    expect(calls).toHaveLength(0);
    expect(await t.count("discord_dates" as never)).toBe(0);
  });
});

describe("/date", () => {
  it("drafts, saves and books the member's character, posts the date, takes calls and closes them at the reveal", async () => {
    turnOn();
    vi.stubEnv("DISCORD_BOT_CALL_WINDOW_SECONDS", "86400"); // longer than the token: the Reveal button reveals it
    await attested(ALICE);
    scriptOutcome({ ending: "friends" });
    scriptedModel([reading(), episodeJson()]);
    const { fetchImpl, sent } = fakeDiscord();

    const res = await post(dateCmd(ALICE, "A night-shift baker who names every sourdough starter."), fetchImpl);
    expect(res.body).toEqual({ type: 5, data: { flags: 64, allowed_mentions: { parse: [] } } });

    // Their character, under the identity the bot made for them, with their own words; a speed date with the house cast.
    const owner = (await t.db.query<{ owner_id: string }>(`select owner_id from discord_members where discord_id = $1`, [ALICE])).rows[0].owner_id;
    const ch = (await t.db.query<{ id: string; name: string; bio: string }>(`select id, name, bio from characters where owner_id = $1`, [owner])).rows;
    expect(ch).toHaveLength(1);
    expect(ch[0].bio).toContain("sourdough");
    const ep = (await t.db.query<{ id: string; status: string; visibility: string; revealed_at: Date | null; partner: string; format: string | null }>(
      `select e.id, e.status, e.visibility, e.revealed_at, e.character_b as partner, e.setup->>'format' as format from episodes e where e.character_a = $1`,
      [ch[0].id],
    )).rows[0];
    expect(ep.status).toBe("ready");
    expect(ep.visibility).toBe("unlisted");
    expect(HOUSE_CHARACTERS.some((c) => c.id === ep.partner)).toBe(true);
    expect(ep.revealed_at).toBeNull();
    const row = (await t.db.query<{ guild_id: string; episode_id: string; message_id: string | null }>(`select guild_id, episode_id, message_id from discord_dates`)).rows[0];
    expect(row).toMatchObject({ guild_id: GUILD, episode_id: ep.id });
    expect(row.message_id).toMatch(/^\d+$/);

    // Two calls out: the member's own answer (edited, only to them) and the date in the channel, both on the interaction's webhook.
    expect(sent.map((s) => s.method)).toEqual(["PATCH", "POST"]);
    expect(sent[0].url).toBe(`https://discord.com/api/v10/webhooks/${APP}/${TOKEN}/messages/@original`);
    expect(sent[1].url).toBe(`https://discord.com/api/v10/webhooks/${APP}/${TOKEN}`);
    expect(sent[1].body.flags).toBeUndefined();
    expect(sent[1].body.embeds[0].title).toContain(ch[0].name.split(" ")[0]);
    const buttons = sent[1].body.components.flatMap((r: { components: { custom_id?: string }[] }) => r.components.map((b) => b.custom_id));
    expect(buttons).toEqual([`bz:call:${ep.id}:second_date`, `bz:call:${ep.id}:friends`, `bz:call:${ep.id}:disaster`, `bz:reveal:${ep.id}`]);

    // The server calls it. A call can change; the member who sent their character can't call their own date.
    const bob = await post(press(BOB, `bz:call:${ep.id}:disaster`, "@everyone"), fetchImpl);
    expect(bob.body.data.content).toContain("A disaster");
    await post(press(BOB, `bz:call:${ep.id}:friends`, "@everyone"), fetchImpl);
    await post(press(CARA, `bz:call:${ep.id}:second_date`), fetchImpl);
    const own = await post(press(ALICE, `bz:call:${ep.id}:friends`), fetchImpl);
    expect(own.body.data.content).toMatch(/your character's date/);
    expect((await t.db.query(`select discord_id, pick from discord_calls order by discord_id`)).rows).toEqual([
      { discord_id: BOB, pick: "friends" },
      { discord_id: CARA, pick: "second_date" },
    ]);

    // Too early to reveal: calls are still open.
    const early = await post(press(CARA, `bz:reveal:${ep.id}`), fetchImpl);
    expect(early.body.data.flags).toBe(64);
    expect(early.body.data.content).toMatch(/Calls are open/);

    // The window passes: the reveal closes the date's message and posts the ending as a follow-up.
    await t.db.query(`update discord_dates set calls_close_at = now() - interval '1 minute'`);
    const before = sent.length;
    const reveal = await post(press(CARA, `bz:reveal:${ep.id}`), fetchImpl);
    expect(reveal.body.type).toBe(7);
    expect(reveal.body.data.components).toEqual([]);
    const follow = sent.slice(before);
    expect(follow).toHaveLength(1);
    const out = follow[0].body;
    expect(out.content).toContain("Just friends");
    expect(out.embeds[0].fields[0].value).toContain("\\@everyone (1 of 2 calls)");
    expect(out.embeds[0].url).toBe(`${SITE}/episodes/${ep.id}?utm_source=discord&utm_medium=bot&utm_campaign=date`);
    expect(out.components[0].components[0]).toMatchObject({ style: 5, url: out.embeds[0].url });
    // The site aired it too, and calls are closed.
    expect((await t.db.query<{ revealed_at: Date | null }>(`select revealed_at from episodes where id = $1`, [ep.id])).rows[0].revealed_at).not.toBeNull();
    const late = await post(press(BOB, `bz:call:${ep.id}:disaster`), fetchImpl);
    expect(late.body.data.content).toMatch(/Calls are closed/);
    expect((await t.db.query(`select pick from discord_calls where discord_id = $1`, [BOB])).rows[0]).toEqual({ pick: "friends" });
    const again = await post(press(CARA, `bz:reveal:${ep.id}`), fetchImpl);
    expect(again.body.data.content).toMatch(/out already/);

    // Never a ping: every body sent out and every answer.
    expectNoPings([...sent.map((s) => s.body), bob.body.data, own.body.data, early.body.data, reveal.body.data, late.body.data, again.body.data]);
    // The only address the bot ever called is the interaction's own webhook.
    expect(new Set(sent.map((s) => new URL(s.url).origin))).toEqual(new Set(["https://discord.com"]));
  });

  it("reveals by itself when the calls' window closes inside the token's life", async () => {
    vi.stubEnv("DISCORD_BOT_CALL_WINDOW_SECONDS", "0");
    vi.stubEnv("SITE_URL", SITE);
    await attested(ALICE);
    scriptOutcome({ ending: "second_date" });
    scriptedModel([reading(), episodeJson()]);
    const { fetchImpl, sent } = fakeDiscord();
    const ctx: BotContext = { ...botContext(t.db, APP, process.env, fetchImpl), sleep: async () => {} };
    const handled = await handleInteraction(ctx, dateCmd(ALICE, "A night-shift baker who names every sourdough starter."));
    await handled.work!();
    expect(sent.map((s) => s.method)).toEqual(["PATCH", "POST", "PATCH", "POST"]);
    expect(sent[2].url).toMatch(/\/messages\/\d+$/);
    expect(sent[2].body.components).toEqual([]);
    expect(sent[3].body.content).toContain("A second date");
    expect(sent[3].body.embeds[0].fields[0].value).toBe("Nobody called this one.");
    expect((await t.db.query(`select revealed_at is not null as r from discord_dates`)).rows[0]).toEqual({ r: true });
    expectNoPings(sent.map((s) => s.body));
  });

  it("when the model is down, tells only the member in the site's plain words and gives the day's slot back", async () => {
    turnOn();
    await attested(ALICE);
    scriptedModel([new Error("model down")]);
    const { fetchImpl, sent } = fakeDiscord();
    const res = await post(dateCmd(ALICE, "A night-shift baker who names every sourdough starter."), fetchImpl);
    expect(res.body.type).toBe(5);
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe("PATCH");
    expect(sent[0].body.content).toBe("The show's writer couldn't draft them just now. Try /date again in a minute.");
    expect(await t.count("discord_dates" as never)).toBe(0);
    expect(await t.count("episodes" as never)).toBe(0);
    expectNoPings(sent.map((s) => s.body));
  });

  it("holds the per-server and per-member daily caps, and works only in a server", async () => {
    turnOn();
    vi.stubEnv("DISCORD_BOT_DAILY_DATES_PER_GUILD", "2");
    vi.stubEnv("DISCORD_BOT_DAILY_DATES_PER_USER", "1");
    for (const who of [ALICE, BOB, CARA]) await attested(who);
    const { fetchImpl } = fakeDiscord();
    // The slots only: no work runs (the after-the-answer work is dropped here).
    setDiscordAfterForTests(() => {});
    const text = "A night-shift baker who names every sourdough starter.";
    expect((await post(dateCmd(ALICE, text), fetchImpl)).body.type).toBe(5);
    expect((await post(dateCmd(ALICE, text), fetchImpl)).body.data.content).toMatch(/your 1 dates for today/);
    expect((await post(dateCmd(BOB, text), fetchImpl)).body.type).toBe(5);
    expect((await post(dateCmd(CARA, text), fetchImpl)).body.data.content).toMatch(/This server has had its 2 dates/);
    const dm = await post(dateCmd(CARA, text, null), fetchImpl);
    expect(dm.body.data.content).toMatch(/works in a server/);
  });
});

describe("/leaderboard", () => {
  async function revealed(guild: string, ending: string, at: string, picks: [string, string, string][]) {
    const ep = crypto.randomUUID();
    const a = HOUSE_CHARACTERS[0].id;
    const b = HOUSE_CHARACTERS[1].id;
    await t.db.query(`insert into episodes (id, creator_id, character_a, character_b, ending, status, setting, goals, scenes, twist, finale) values ($1, $2, $3, $4, $5, 'ready', '', '[]', '[]', '', '')`, [ep, crypto.randomUUID(), a, b, ending]);
    await t.db.query(`insert into discord_dates (id, guild_id, discord_id, episode_id, revealed_at) values ($1, $2, $3, $4, $5)`, [crypto.randomUUID(), guild, ALICE, ep, at]);
    for (const [who, name, pick] of picks) await t.db.query(`insert into discord_calls (guild_id, episode_id, discord_id, display_name, pick) values ($1, $2, $3, $4, $5)`, [guild, ep, who, name, pick]);
  }

  it("is this server's right calls on dates revealed this month, best first, with names escaped and nobody pinged", async () => {
    turnOn();
    const now = new Date();
    const thisMonth = now.toISOString();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)).toISOString();
    await revealed(GUILD, "friends", thisMonth, [[BOB, "@here Bob", "friends"], [CARA, "Cara", "disaster"]]);
    await revealed(GUILD, "disaster", thisMonth, [[BOB, "@here Bob", "disaster"], [CARA, "Cara", "disaster"]]);
    await revealed(GUILD, "friends", lastMonth, [[CARA, "Cara", "friends"], [CARA + "9", "Old", "friends"]]);
    await revealed("123456789012345678", "friends", thisMonth, [[ALICE, "Elsewhere", "friends"]]);

    const board = await guildBoard(t.db, GUILD, now);
    expect(board.map((r) => [r.discord_id, r.right, r.calls])).toEqual([
      [BOB, 2, 2],
      [CARA, 1, 2],
    ]);

    const { fetchImpl } = fakeDiscord();
    const res = await post({ type: 2, application_id: APP, token: TOKEN, guild_id: GUILD, member: member(CARA), data: { name: "leaderboard" } }, fetchImpl);
    expect(res.body.type).toBe(4);
    const text = res.body.data.embeds[0].description as string;
    expect(text.split("\n")).toEqual(["1. \\@here Bob: 2 of 2", "2. Cara: 1 of 2"]);
    expect(res.body.data.allowed_mentions).toEqual({ parse: [] });
  });

  it("a reveal waits for the date to be filmed and its calls' window", async () => {
    const ep = crypto.randomUUID();
    await t.db.query(`insert into episodes (id, creator_id, character_a, character_b, ending, status, setting, goals, scenes, twist, finale) values ($1, $2, $3, $4, 'friends', 'generating', '', '[]', '[]', '', '')`, [ep, crypto.randomUUID(), HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
    await t.db.query(`insert into discord_dates (id, guild_id, discord_id, episode_id, calls_close_at) values ($1, $2, $3, $4, now() + interval '1 hour')`, [crypto.randomUUID(), GUILD, ALICE, ep]);
    expect(await claimReveal(t.db, ep, new Date())).toBeNull();
    await t.db.query(`update episodes set status = 'ready' where id = $1`, [ep]);
    expect(await claimReveal(t.db, ep, new Date())).toBeNull();
    expect(await claimReveal(t.db, ep, new Date(Date.now() + 2 * 3600_000))).toEqual({ guild_id: GUILD });
    expect(await claimReveal(t.db, ep, new Date(Date.now() + 3 * 3600_000))).toBeNull(); // once
  });
});

describe("the client", () => {
  it("sends allowed_mentions last, so no message can turn pings back on, and never calls with a malformed token", async () => {
    expect(botBody({ content: "hi", ...({ allowed_mentions: { parse: ["everyone"] } } as object) }).allowed_mentions).toEqual({ parse: [] });
    const { fetchImpl, sent } = fakeDiscord();
    const client = interactionClient(APP, fetchImpl);
    expect((await client.followUp("../../users/@me", { content: "x" })).ok).toBe(false);
    expect((await client.editMessage(TOKEN, "../1", { content: "x" })).ok).toBe(false);
    expect(sent).toEqual([]);
  });

  it("a failed /date logs the status, never the token", async () => {
    scriptedModel([new Error("model down")]);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    const ctx = botContext(t.db, APP, {}, fetchImpl);
    await runDate(ctx, { slot: crypto.randomUUID(), token: TOKEN, ownerId: crypto.randomUUID(), discordId: ALICE, guildId: GUILD, text: "x".repeat(10), startedAt: new Date() });
    const logged = errors.mock.calls.flat().join(" ");
    expect(logged).toContain("HTTP 404");
    expect(logged).not.toContain(TOKEN);
  });
});
