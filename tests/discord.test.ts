// The show's Discord (docs/discord.md; 2026-11-07 audit, item 13): built and off. A bot posts the episode digest,
// Sunday's vote and the board from the hourly lobby job, each once, never pinging anyone, never logging its webhook, and
// only what a signed-out visitor already sees on the site. The invite shows on the site only once it's set.
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The root layout reads the viewer from next/headers (an anonymous visitor here), and its nav the page it's on.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, getAll: () => [] }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { renderToStaticMarkup } from "react-dom/server";
import RootLayout from "@/app/layout";
import { llmsText } from "@/lib/agents";
import { SECRET_POOL } from "@/lib/cast-secrets";
import {
  DISCORD_TRIES,
  discordInviteUrl,
  discordKindsOn,
  discordLink,
  discordWebhook,
  escapeDiscord,
  isDiscordWebhookUrl,
  postOnce,
  webhookBody,
} from "@/lib/discord";
import { dropsWindow, duePosts, postDueDiscord, rankDrops, type DropItem } from "@/lib/discord-posts";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { ENDING_LABELS } from "@/lib/rules";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { ensureRevealVote, runDueReveal, voteReveal } from "@/lib/weekly-reveal";
import { episodeJson, scriptedModel, startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});
afterEach(() => {
  setSeasonCastForTests(HOUSE_CHARACTERS.map((c) => c.id));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// Built from parts, so no line here looks like a real webhook address (GitGuardian scans every commit).
const HOOK_HOST = ["discord", "com"].join(".");
const HOOK_PATH = ["api", ["web", "hooks"].join("")].join("/");
const TOKEN = (name: string) => `${name}${"Qx7".repeat(14)}`;
const hook = (name: string, host = HOOK_HOST) => `https://${host}/${HOOK_PATH}/${"4".repeat(18)}/${TOKEN(name)}`;
const MAIN = hook("main");
const SITE = "https://botchelor.com";
const ON = { DISCORD_WEBHOOK_URL: MAIN, SITE_URL: SITE };

type Sent = { url: string; body: Record<string, any> };
/** A stand-in for Discord: answers each send with the next status (the last one repeats), or throws for "throw". */
function fakeDiscord(...statuses: (number | "throw")[]) {
  const sent: Sent[] = [];
  let i = 0;
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const status = statuses.length ? statuses[Math.min(i++, statuses.length - 1)] : 204;
    if (status === "throw") throw new Error(`connect ECONNREFUSED while posting to ${String(url)}`);
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

let seq = 0;
async function character(name: string, opts: { visibility?: "public" | "private"; agent?: boolean } = {}): Promise<string> {
  const id = `dc-${++seq}`;
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, created_via)
     values ($1, $2, false, $3, 30, 'Keeps bees.', '["dry"]'::jsonb, 'x', 'x', $4, $5)`,
    [id, `owner-${id}`, name, opts.visibility ?? "public", opts.agent ? "mcp" : "web"],
  );
  return id;
}

type DateOpts = {
  aired?: string | null;
  visibility?: "public" | "private" | "unlisted";
  setup?: Record<string, unknown>;
  title?: string | null;
  group?: string | null;
  ending?: "second_date" | "friends" | "disaster";
  calls?: number;
  watchers?: number;
  reports?: number;
};
async function date(id: string, a: string, b: string, opts: DateOpts = {}): Promise<string> {
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, status, visibility, setup, title, group_id)
     values ($1, 'someone', $2, $3, $4, '[]'::jsonb, '[]'::jsonb, '', '', $5, $6, 'ready', $7, $8::jsonb, $9, $10)`,
    [id, a, b, `A rooftop at dusk for ${id}, where the string lights keep failing.`, opts.ending ?? "friends", opts.aired === undefined ? "2026-11-10T07:00:00Z" : opts.aired, opts.visibility ?? "public", JSON.stringify(opts.setup ?? {}), opts.title ?? null, opts.group ?? null],
  );
  for (let i = 0; i < (opts.calls ?? 0); i++) await t.db.query(`insert into predictions (episode_id, user_id, pick) values ($1, $2, 'friends')`, [id, `caller-${i}`]);
  if (opts.watchers) {
    await t.db.query(`insert into watch_parties (id, episode_id, kind) values ($1, $2, 'template')`, [`room-${id}`, id]);
    for (let i = 0; i < opts.watchers; i++) await t.db.query(`insert into watch_presence (party_id, user_id) values ($1, $2)`, [`room-${id}`, `viewer-${i}`]);
  }
  for (let i = 0; i < (opts.reports ?? 0); i++) await t.db.query(`insert into reports (episode_id, reporter_id) values ($1, $2)`, [id, `reporter-${i}`]);
  return id;
}
const night = (id: string, kind: "double" | "mixer", venue = "late_night_diner") =>
  t.db.query(`insert into group_nights (id, kind, venue, created_by, status, couple_a, couple_b) values ($1, $2, $3, 'house', 'done', '{}'::jsonb, '{}'::jsonb)`, [id, kind, venue]);

const TUE_NOON = new Date("2026-11-10T12:20:00Z");
const rows = async () => (await t.db.query<{ key: string; kind: string; tries: number; posted_at: unknown; claimed_at: unknown }>(`select key, kind, tries, posted_at, claimed_at from discord_posts order by key`)).rows;

describe("built and off", () => {
  it("posts nothing, reads nothing and stores nothing until a webhook is set", async () => {
    const a = await character("Mara Vance");
    const b = await character("Jules Okafor");
    await date("e-off", a, b, { calls: 4 });
    const { sent, fetchImpl } = fakeDiscord();
    expect(discordKindsOn({})).toEqual([]);
    expect(await postDueDiscord(t.db, TUE_NOON, { env: {}, fetchImpl })).toEqual({ off: true });
    expect(await postOnce(t.db, { key: "drops:x", kind: "drops", message: { content: "hi" } }, { env: {}, fetchImpl })).toBe("off");
    expect(sent).toHaveLength(0);
    expect(await rows()).toEqual([]);
  });

  it("takes only an https webhook on discord.com or discordapp.com, and a typo'd channel turns that kind off rather than posting elsewhere", () => {
    expect(isDiscordWebhookUrl(MAIN)).toBe(true);
    expect(isDiscordWebhookUrl(hook("legacy", ["discordapp", "com"].join(".")))).toBe(true);
    expect(isDiscordWebhookUrl(MAIN.replace("https:", "http:"))).toBe(false);
    expect(isDiscordWebhookUrl(hook("x", `${HOOK_HOST}.evil.example`))).toBe(false);
    expect(isDiscordWebhookUrl(hook("x", `canary.${HOOK_HOST}`))).toBe(false);
    expect(isDiscordWebhookUrl(MAIN.replace(HOOK_HOST, `${HOOK_HOST}:8443`))).toBe(false);
    expect(isDiscordWebhookUrl(MAIN.replace("https://", "https://me:pw@"))).toBe(false);
    expect(isDiscordWebhookUrl(`https://${HOOK_HOST}/api/channels/1/messages`)).toBe(false);
    expect(isDiscordWebhookUrl("CHANGE_ME")).toBe(false);

    const drops = hook("drops");
    // A kind's own address wins; the spec's placeholder counts as unset (that kind goes to the main channel); a typo'd
    // address turns its kind off.
    const env = { DISCORD_WEBHOOK_URL: MAIN, DISCORD_WEBHOOK_DROPS: drops, DISCORD_WEBHOOK_VOTES: "CHANGE_ME", DISCORD_WEBHOOK_BOARD: hook("board").replace("https:", "http:") };
    expect(discordWebhook("drops", env)).toBe(drops);
    expect(discordWebhook("votes", env)).toBe(MAIN);
    expect(discordWebhook("board", env)).toBeNull();
    expect(discordKindsOn(env)).toEqual(["drops", "votes"]);
    expect(discordKindsOn({ DISCORD_WEBHOOK_URL: "https://example.com/hook" })).toEqual([]);
    // .do/show.yaml as committed, every webhook a placeholder: off.
    expect(discordKindsOn({ DISCORD_WEBHOOK_URL: "CHANGE_ME", DISCORD_WEBHOOK_DROPS: "CHANGE_ME", DISCORD_WEBHOOK_VOTES: "CHANGE_ME", DISCORD_WEBHOOK_BOARD: "CHANGE_ME" })).toEqual([]);
  });

  it("never posts from After Dark's host, and never shows the invite there", () => {
    const adHost = { AFTER_DARK_ONLY: "1", AFTER_DARK_ORIGIN: "https://ad.botchelor.com" };
    expect(discordKindsOn({ ...ON, ...adHost })).toEqual([]);
    expect(discordInviteUrl({ DISCORD_INVITE_URL: "https://discord.gg/botchelor", ...adHost })).toBeNull();
  });

  it("shows the invite only once DISCORD_INVITE_URL is a Discord invite: in the footer, on /llms.txt", async () => {
    expect(discordInviteUrl({})).toBeNull();
    expect(discordInviteUrl({ DISCORD_INVITE_URL: "CHANGE_ME" })).toBeNull();
    expect(discordInviteUrl({ DISCORD_INVITE_URL: "https://evil.example/invite/botchelor" })).toBeNull();
    expect(discordInviteUrl({ DISCORD_INVITE_URL: "http://discord.gg/botchelor" })).toBeNull();
    expect(discordInviteUrl({ DISCORD_INVITE_URL: " https://discord.gg/botchelor/ " })).toBe("https://discord.gg/botchelor");
    expect(discordInviteUrl({ DISCORD_INVITE_URL: "https://discord.com/invite/aB3-xyz" })).toBe("https://discord.com/invite/aB3-xyz");

    const footer = async () => {
      const html = renderToStaticMarkup(await RootLayout({ children: null }));
      return html.slice(html.indexOf('<footer class="site-footer"'));
    };
    expect(await footer()).not.toMatch(/discord/i);
    vi.stubEnv("DISCORD_INVITE_URL", "https://discord.gg/botchelor");
    expect(await footer()).toContain('href="https://discord.gg/botchelor"');
    vi.stubEnv("AFTER_DARK_ONLY", "1");
    vi.stubEnv("AFTER_DARK_ORIGIN", "https://ad.botchelor.com");
    expect(await footer()).not.toMatch(/discord/i);

    expect(llmsText(SITE, null, null)).not.toMatch(/discord/i);
    expect(llmsText(SITE, null, "https://discord.gg/botchelor")).toMatch(/\[The show's Discord\]\(https:\/\/discord\.gg\/botchelor\)/);
  });

  it("runs from the hourly lobby job after what it posts about, best-effort, and says what it sent", () => {
    const route = readFileSync(new URL("../app/api/jobs/lobby/route.ts", import.meta.url), "utf8");
    const call = route.indexOf("postDueDiscord(db).catch(");
    expect(call).toBeGreaterThan(-1);
    for (const before of ["airDueDates(db)", "runDueReveal(db)", "revealDueSeasonPool(db)"]) expect(route.indexOf(before)).toBeLessThan(call);
    expect(route.indexOf("refreshLobby(db")).toBeGreaterThan(call);
    expect(route).toMatch(/cast_chat: castChat, discord,/);
  });
});

describe("the episode digest", () => {
  it("is one post every six hours, keyed by its slot, for the dates that aired in the hours before", () => {
    expect(dropsWindow(TUE_NOON)).toEqual({ key: "drops:2026-11-10T12", from: new Date("2026-11-10T06:00:00Z"), to: new Date("2026-11-10T12:00:00Z") });
    expect(dropsWindow(new Date("2026-11-10T05:59:00Z")).key).toBe("drops:2026-11-10T00");
    expect(duePosts(TUE_NOON).map((d) => d.key)).toEqual(["drops:2026-11-10T12"]);
  });

  it("picks the best few public dates that aired: the season cast's first, then the most called and watched, a night as one item, never a spoiler", async () => {
    const [h0, h1] = HOUSE_CHARACTERS.map((c) => c.id);
    setSeasonCastForTests([h0, h1]);
    const mara = await character("Mara Vance");
    const jules = await character("Jules Okafor");
    const odile = await character("Odile Brand");
    const hal = await character("Hal Pruitt");
    const bot = await character("Unit Nine", { agent: true });
    const sam = await character("Sam Hidden", { visibility: "private" });
    const quinn = await character("Quinn Tester");
    const singles = await Promise.all(["Sable Ray", "Greta Moss", "Sigrid Lund", "Barnaby Cole"].map((n) => character(n)));

    await date("e-cast", h0, mara, { aired: "2026-11-10T07:00:00Z", title: "The Lighthouse Bet", ending: "second_date" });
    await date("e-watched", hal, bot, { aired: "2026-11-10T09:00:00Z", setup: { date_number: 2 }, title: "The second date", calls: 1, watchers: 6, ending: "disaster" });
    await date("e-popular", jules, odile, { aired: "2026-11-10T08:00:00Z", calls: 5 });
    await night("n-mixer", "mixer");
    await date("e-t1", singles[0], singles[1], { aired: "2026-11-10T10:00:00Z", group: "n-mixer", calls: 2 });
    await date("e-t2", singles[2], singles[3], { aired: "2026-11-10T10:05:00Z", group: "n-mixer", calls: 2 });
    await date("e-t3", singles[0], singles[3], { aired: "2026-11-10T10:10:00Z", group: "n-mixer", calls: 2 });
    // Never posted, however busy: private, unlisted, an After Dark memory, not aired, reported, a private or test
    // character, aired before the window or after it.
    await date("x-private", mara, jules, { visibility: "private", calls: 30 });
    await date("x-unlisted", mara, odile, { visibility: "unlisted", calls: 30 });
    await date("x-afterdark", jules, hal, { setup: { after_dark: true }, calls: 30 });
    await date("x-unaired", odile, hal, { aired: null, calls: 30 });
    await date("x-reported", mara, hal, { calls: 30, reports: 3 });
    await date("x-private-char", mara, sam, { calls: 30 });
    await date("x-test-char", jules, quinn, { calls: 30 });
    await date("x-before", odile, bot, { aired: "2026-11-10T05:59:00Z", calls: 30 });
    await date("x-after", odile, jules, { aired: "2026-11-10T12:01:00Z", calls: 30 });

    const { sent, fetchImpl } = fakeDiscord();
    expect(await postDueDiscord(t.db, TUE_NOON, { env: ON, fetchImpl })).toEqual({ posted: ["drops:2026-11-10T12"], failed: [] });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(MAIN);
    const body = sent[0].body;
    const raw = JSON.stringify(body);
    expect(body.content).toMatch(/^📺 \*\*Just aired on Botchelor\.\*\*/);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.username).toBe("Botchelor");
    expect(body.avatar_url).toBe(`${SITE}/icons/apple-touch-icon.png`);

    // Three items, best first: the cast's date, then the most called and watched (7), then the mixer night (6); the
    // fourth (5 calls) waits out.
    expect(body.embeds.map((e: { title: string }) => e.title)).toEqual([
      escapeDiscord(`${HOUSE_CHARACTERS[0].name} × Mara Vance`),
      "Hal Pruitt × Unit Nine",
      expect.stringMatching(/^Speed-dating night at /),
    ]);
    const [lead, watched, mixer] = body.embeds;
    expect(lead.url).toBe(`${SITE}/episodes/e-cast?utm_source=discord&utm_medium=drops&utm_campaign=digest`);
    expect(lead.description).toMatch(/^“The Lighthouse Bet”\n/);
    // The lead carries the spoiler-free share card; the rest carry no picture.
    expect(lead.image).toEqual({ url: `${SITE}/api/og/episode/e-cast` });
    expect(watched.image).toBeUndefined();
    // The template title isn't repeated; the badges say which date it is and who made the characters.
    expect(watched.description).not.toMatch(/“/);
    expect(watched.footer).toEqual({ text: "Second date · Made by an AI agent" });
    expect(mixer.url).toBe(`${SITE}/mixers/n-mixer?utm_source=discord&utm_medium=drops&utm_campaign=digest`);
    expect(mixer.description).toMatch(/^4 singles · 3 tables aired\nSable × Greta · Sigrid × Barnaby · Sable × Barnaby$/);
    for (const x of ["x-private", "x-unlisted", "x-afterdark", "x-unaired", "x-reported", "x-private-char", "x-test-char", "x-before", "x-after", "e-popular"]) expect(raw).not.toContain(x);
    for (const words of [...Object.values(ENDING_LABELS), "second_date", "disaster", "ending"]) expect(raw).not.toContain(words);

    // What it featured is remembered, so a night still airing tables in the next window isn't posted twice. The date that
    // aired at 12:01 is the next digest's, the busiest in it.
    await date("e-t4", singles[1], singles[2], { aired: "2026-11-10T13:00:00Z", group: "n-mixer", calls: 9 });
    await date("e-next", jules, hal, { aired: "2026-11-10T14:00:00Z" });
    expect(await postDueDiscord(t.db, new Date("2026-11-10T18:20:00Z"), { env: ON, fetchImpl })).toEqual({ posted: ["drops:2026-11-10T18"], failed: [] });
    expect(sent[1].body.embeds.map((e: { title: string }) => e.title)).toEqual(["Odile Brand × Jules Okafor", "Jules Okafor × Hal Pruitt"]);
    expect(sent[1].body.embeds[0].url).toContain("/episodes/x-after?");
  });

  it("puts a double date's two tables in one item, and skips a window where nothing aired", async () => {
    const [a, b, c, d] = await Promise.all(["Mara Vance", "Jules Okafor", "Odile Brand", "Hal Pruitt"].map((n) => character(n)));
    await night("n-double", "double");
    await date("e-table-a", a, b, { group: "n-double", aired: "2026-11-10T09:00:00Z" });
    await date("e-table-b", c, d, { group: "n-double", aired: "2026-11-10T09:01:00Z" });
    const { sent, fetchImpl } = fakeDiscord();
    await postDueDiscord(t.db, TUE_NOON, { env: ON, fetchImpl });
    expect(sent[0].body.embeds).toHaveLength(1);
    expect(sent[0].body.embeds[0]).toMatchObject({
      title: "Double date: Mara Vance × Jules Okafor and Odile Brand × Hal Pruitt",
      url: `${SITE}/episodes/e-table-a?utm_source=discord&utm_medium=drops&utm_campaign=digest`,
      footer: { text: "Double date" },
      image: { url: `${SITE}/api/og/episode/e-table-a` },
    });
    // Six hours later nothing new aired: no post, and nothing stored for it.
    expect(await postDueDiscord(t.db, new Date("2026-11-10T18:20:00Z"), { env: ON, fetchImpl })).toEqual({ posted: [], failed: [] });
    expect(sent).toHaveLength(1);
    expect((await rows()).map((r) => r.key)).toEqual(["drops:2026-11-10T12"]);
  });

  it("ranks the season cast first, then by calls and watchers, then the newest", () => {
    const item = (key: string, cast: boolean, score: number, aired_at: number): DropItem => ({ key, kind: "date", night: null, night_id: null, venue: null, theme: null, dates: [], cast, score, aired_at });
    expect(rankDrops([item("a", false, 9, 1), item("b", true, 0, 1), item("c", false, 9, 2), item("d", false, 1, 3)]).map((i) => i.key)).toEqual(["b", "c", "a", "d"]);
  });
});

describe("posting once, safely", () => {
  async function oneAiredDate() {
    const a = await character("@everyone");
    const b = await character("[Free nitro](https://phish.example) ||spoiler||");
    await date("e-one", a, b, { aired: "2026-11-10T08:00:00Z" });
  }

  it("goes out once per key, even when two passes run at once or the job runs again", async () => {
    await oneAiredDate();
    const { sent, fetchImpl } = fakeDiscord();
    const [first, second] = await Promise.all([postDueDiscord(t.db, TUE_NOON, { env: ON, fetchImpl }), postDueDiscord(t.db, TUE_NOON, { env: ON, fetchImpl })]);
    expect([...("posted" in first ? first.posted : []), ...("posted" in second ? second.posted : [])]).toEqual(["drops:2026-11-10T12"]);
    expect(await postDueDiscord(t.db, new Date("2026-11-10T13:20:00Z"), { env: ON, fetchImpl })).toEqual({ posted: [], failed: [] });
    expect(sent).toHaveLength(1);
    expect(await rows()).toMatchObject([{ key: "drops:2026-11-10T12", kind: "drops", tries: 1, claimed_at: null }]);
  });

  it("never pings: mentions are off, and names can't become a ping, a link or a spoiler", async () => {
    await oneAiredDate();
    const { sent, fetchImpl } = fakeDiscord();
    await postDueDiscord(t.db, TUE_NOON, { env: ON, fetchImpl });
    const body = sent[0].body;
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds[0].title).toBe("\\@everyone × \\[Free nitro\\](https\\://phish.example) \\|\\|spoiler\\|\\|");
    expect(JSON.stringify(body)).not.toMatch(/(^|[^\\])@everyone/);

    expect(escapeDiscord("**b** __u__ ~~s~~ `c` > q <@123> <t:1:R> # h")).toBe("\\*\\*b\\*\\* \\_\\_u\\_\\_ \\~\\~s\\~\\~ \\`c\\` \\> q \\<\\@123\\> \\<t\\:1\\:R\\> \\# h");
    expect(escapeDiscord("- a list\n1. or this")).toBe("\\- a list\n1\\. or this");
    expect(webhookBody({ content: "x".repeat(2500), embeds: [{ title: "y".repeat(300) }] }, SITE)).toMatchObject({
      content: "x".repeat(2000),
      embeds: [{ title: `${"y".repeat(255)}…`, color: 0xd6336c }],
      allowed_mentions: { parse: [] },
    });
  });

  it("logs a failure as one line, the kind and the status, never the webhook address", async () => {
    await oneAiredDate();
    const logged: string[] = [];
    for (const level of ["log", "info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
    const { fetchImpl } = fakeDiscord(500, "throw");
    const first = await postDueDiscord(t.db, TUE_NOON, { env: ON, fetchImpl });
    const second = await postDueDiscord(t.db, new Date("2026-11-10T13:20:00Z"), { env: ON, fetchImpl });
    expect(logged).toEqual(["[discord] drops post failed: HTTP 500", "[discord] drops post failed: no answer"]);
    const everything = [...logged, JSON.stringify(first), JSON.stringify(second), JSON.stringify(await rows())].join("\n");
    expect(everything).not.toContain(TOKEN("main"));
    expect(everything).not.toContain(HOOK_PATH);
  });

  it("gives a failed post back for the next pass, and gives up after DISCORD_TRIES", async () => {
    await oneAiredDate();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sent, fetchImpl } = fakeDiscord(503);
    const passes = ["12:20", "13:20", "14:20", "15:20"].map((hm) => new Date(`2026-11-10T${hm}:00Z`));
    const results = [];
    for (const at of passes) results.push(await postDueDiscord(t.db, at, { env: ON, fetchImpl }));
    expect(DISCORD_TRIES).toBe(3);
    expect(sent).toHaveLength(3);
    expect(results).toEqual([
      { posted: [], failed: ["drops:2026-11-10T12"] },
      { posted: [], failed: ["drops:2026-11-10T12"] },
      { posted: [], failed: ["drops:2026-11-10T12"] },
      { posted: [], failed: [] },
    ]);
    expect(await rows()).toMatchObject([{ tries: 3, posted_at: null, claimed_at: null }]);
    expect(console.error).toHaveBeenLastCalledWith("[discord] drops post failed: HTTP 503, giving up");
  });

  it("retries next pass and posts once it goes through; a claim left by a dead pass is taken over, a live one isn't", async () => {
    await oneAiredDate();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sent, fetchImpl } = fakeDiscord(500, 204);
    expect(await postDueDiscord(t.db, TUE_NOON, { env: ON, fetchImpl })).toEqual({ posted: [], failed: ["drops:2026-11-10T12"] });
    expect(await postDueDiscord(t.db, new Date("2026-11-10T13:20:00Z"), { env: ON, fetchImpl })).toEqual({ posted: ["drops:2026-11-10T12"], failed: [] });
    expect(await postDueDiscord(t.db, new Date("2026-11-10T14:20:00Z"), { env: ON, fetchImpl })).toEqual({ posted: [], failed: [] });
    expect(sent).toHaveLength(2);
    expect(await rows()).toMatchObject([{ tries: 2, claimed_at: null }]);

    const post = { key: "board:test", kind: "board" as const, message: { content: "the board" } };
    await t.db.query(`insert into discord_posts (key, kind, claimed_at) values ('board:test', 'board', $1)`, [new Date(TUE_NOON.getTime() - 2 * 60_000).toISOString()]);
    expect(await postOnce(t.db, post, { env: ON, fetchImpl, now: TUE_NOON })).toBe("taken");
    expect(await postOnce(t.db, post, { env: ON, fetchImpl, now: new Date(TUE_NOON.getTime() + 20 * 60_000) })).toBe("posted");
    expect(sent).toHaveLength(3);
  });

  it("sends each kind to its own channel when one is set, and a typo there turns that kind off", async () => {
    await oneAiredDate();
    const drops = hook("drops");
    const { sent, fetchImpl } = fakeDiscord();
    // A typo'd drops channel, the rest on: no digest at all, rather than one in the wrong channel.
    expect(await postDueDiscord(t.db, TUE_NOON, { env: { ...ON, DISCORD_WEBHOOK_DROPS: drops.replace(HOOK_HOST, "discord.co") }, fetchImpl })).toEqual({ posted: [], failed: [] });
    expect(sent).toHaveLength(0);
    expect(await postDueDiscord(t.db, TUE_NOON, { env: { ...ON, DISCORD_WEBHOOK_DROPS: drops }, fetchImpl })).toEqual({ posted: ["drops:2026-11-10T12"], failed: [] });
    expect(sent.map((s) => s.url)).toEqual([drops]);
  });

  it("tags every link for the engagement log, keeping the anchor", () => {
    expect(discordLink("/watch#sunday-reveal", "votes", "reveal_open", SITE)).toBe(`${SITE}/watch?utm_source=discord&utm_medium=votes&utm_campaign=reveal_open#sunday-reveal`);
  });
});

describe("Sunday's reveal", () => {
  const CAST = HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id);
  const SEASON = "2026-11-01";
  const SAT_OPEN = new Date("2026-11-14T19:20:00Z");
  const SUN_MORNING = new Date("2026-11-15T10:20:00Z");
  const SUN_AIR = new Date("2026-11-15T19:20:00Z");

  async function storeSecrets() {
    setSeasonCastForTests(CAST);
    for (const [i, id] of CAST.entries()) {
      for (let idx = 0; idx < 3; idx++) {
        await t.db.query(`insert into cast_secrets (character_id, season_id, idx, secret, source) values ($1, $2, $3, $4, 'pool')`, [id, SEASON, idx, SECRET_POOL[i * 3 + idx]]);
      }
    }
  }

  it("posts the ballot when the vote opens, never the counts, then the result when it airs, each once", async () => {
    await storeSecrets();
    const row = (await ensureRevealVote(t.db, SAT_OPEN))!;
    const [a, , c] = row.choices.map((x) => x.id);
    await voteReveal(t.db, "u1", c, SAT_OPEN);
    await voteReveal(t.db, "u2", c, SAT_OPEN);
    await voteReveal(t.db, "u3", a, SAT_OPEN);
    expect(duePosts(SUN_MORNING).map((d) => d.key)).toEqual(["drops:2026-11-15T06", "reveal_open:2026-11-15"]);

    const { sent, fetchImpl } = fakeDiscord();
    expect(await postDueDiscord(t.db, SUN_MORNING, { env: ON, fetchImpl })).toEqual({ posted: ["reveal_open:2026-11-15"], failed: [] });
    const open = sent[0].body;
    expect(open.content).toBe("🔓 **Sunday's reveal: the vote is open.** Whose secret comes out?");
    expect(open.embeds[0].url).toBe(`${SITE}/watch?utm_source=discord&utm_medium=votes&utm_campaign=reveal_open#sunday-reveal`);
    expect(open.embeds[0].fields.map((f: { name: string }) => f.name)).toEqual(row.choices.map((x) => escapeDiscord(x.name)));
    expect(open.embeds[0].fields.every((f: { value: string }) => /^0 of 3 secrets out$/.test(f.value))).toBe(true);
    // The closing time in each reader's own time zone, and nothing of how the vote is going.
    expect(open.embeds[0].description).toContain(`<t:${Date.parse("2026-11-15T19:00:00Z") / 1000}:R>`);
    expect(JSON.stringify(open)).not.toMatch(/\d+ votes?\b|%/);
    expect(await postDueDiscord(t.db, new Date("2026-11-15T11:20:00Z"), { env: ON, fetchImpl })).toEqual({ posted: [], failed: [] });

    scriptedModel([episodeJson()]);
    const run = await runDueReveal(t.db, SUN_AIR);
    if (!run.ran) throw new Error(`not run: ${run.reason}`);
    expect(await postDueDiscord(t.db, SUN_AIR, { env: ON, fetchImpl })).toEqual({ posted: ["reveal_result:2026-11-15"], failed: [] });
    const result = sent[1].body;
    const name = row.choices.find((x) => x.id === c)!.name;
    const secret = SECRET_POOL[CAST.indexOf(c) * 3];
    expect(result.content).toBe(`🔓 **Sunday's reveal: ${escapeDiscord(name)}'s secret is out.**`);
    expect(result.embeds[0].description).toMatch(new RegExp(`^“${escapeDiscord(secret).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}”\\n\\n2 of 3 votes\\. .+ has heard it: watch their date\\.$`));
    expect(result.embeds[0].url).toBe(`${SITE}${run.room_path}?utm_source=discord&utm_medium=votes&utm_campaign=reveal_result`);
    expect(await postDueDiscord(t.db, new Date("2026-11-15T20:20:00Z"), { env: ON, fetchImpl })).toEqual({ posted: [], failed: [] });
    expect(sent).toHaveLength(2);
  });

  it("never posts old news: a result switched on two days late stays unposted", async () => {
    await storeSecrets();
    await ensureRevealVote(t.db, SAT_OPEN);
    scriptedModel([episodeJson()]);
    expect((await runDueReveal(t.db, SUN_AIR)).ran).toBe(true);
    const { sent, fetchImpl } = fakeDiscord();
    expect(await postDueDiscord(t.db, new Date("2026-11-17T19:20:00Z"), { env: ON, fetchImpl })).toEqual({ posted: [], failed: [] });
    expect(sent).toHaveLength(0);
  });
});

describe("the board", () => {
  const SUN_AIR = new Date("2026-11-15T19:20:00Z");

  it("posts the week's best callers after Sunday's reveal, named only as the site names them, with how many play the pool", async () => {
    const [a, b, c, d] = await Promise.all(["Mara Vance", "Jules Okafor", "Odile Brand", "Hal Pruitt"].map((n) => character(n)));
    await date("e-w1", a, b, { aired: "2026-11-13T10:00:00Z", ending: "friends" });
    await date("e-w2", c, d, { aired: "2026-11-14T10:00:00Z", ending: "disaster" });
    await t.db.query(`insert into profiles (user_id, name) values ('u-ana', 'Ana [mod](https://x.example)')`);
    await t.db.query(
      `insert into predictions (episode_id, user_id, pick) values ('e-w1', 'u-ana', 'friends'), ('e-w2', 'u-ana', 'disaster'), ('e-w1', 'u-anon', 'friends'), ('e-w2', 'u-anon', 'friends')`,
    );
    const { sent, fetchImpl } = fakeDiscord();
    expect(await postDueDiscord(t.db, SUN_AIR, { env: ON, fetchImpl })).toEqual({ posted: ["board:2026-11-15"], failed: [] });
    const [callers, pool] = sent[0].body.embeds;
    expect(sent[0].body.content).toMatch(/^🏆 \*\*This week's board\.\*\*/);
    expect(callers.title).toBe("Best callers this week");
    expect(callers.url).toBe(`${SITE}/watch?utm_source=discord&utm_medium=board&utm_campaign=callers#best-callers`);
    expect(callers.description).toMatch(/^\*\*1\.\*\* Ana \\\[mod\\\]\(https\\:\/\/x\.example\): 2 of 2\n\*\*2\.\*\* A viewer: 1 of 2\n\nRight endings on public dates that aired in the last 7 days \(2 callers\)\./);
    // The pool while the season runs: how many play and when it's revealed, never its names or scores.
    expect(pool.description).toMatch(/^2 players have points so far\./);
    expect(pool.description).not.toMatch(/\bpts\b|Ana/);
    expect(await postDueDiscord(t.db, new Date("2026-11-15T20:20:00Z"), { env: ON, fetchImpl })).toEqual({ posted: [], failed: [] });
  });

  it("posts the season pool's final board and the new season on the first day of the month", async () => {
    // October's season started on the 19th, when seasons went monthly (lib/season-window.ts). November 1st is also a
    // Sunday, so Sunday's ballot is due too: with no vote open, it has nothing to say.
    const now = new Date("2026-11-01T00:20:00Z");
    const OCTOBER = "2026-10-19";
    await t.db.query(`insert into season_pools (season_id, claimed_at, frozen_at, players) values ($1, $2, $2, 3)`, [OCTOBER, now.toISOString()]);
    await t.db.query(
      `insert into season_pool_entries (season_id, user_id, place, points, calls_right, agent) values
         ($1, 'u-ana', 1, 40, 4, false), ($1, 'u-anon', 2, 30, 3, false), ($1, 'u-agent', 2, 30, 2, true)`,
      [OCTOBER],
    );
    await t.db.query(`insert into profiles (user_id, name) values ('u-ana', 'Ana')`);
    await t.db.query(`insert into season_vote_results (season_id, winner, votes, total) values ('2026-11-01', 'classic', 3, 4)`);
    expect(duePosts(now).map((d) => d.key)).toEqual(["drops:2026-11-01T00", "reveal_open:2026-11-01", "season:2026-11-01", `pool:${OCTOBER}`]);

    const { sent, fetchImpl } = fakeDiscord();
    expect(await postDueDiscord(t.db, now, { env: ON, fetchImpl })).toEqual({ posted: ["season:2026-11-01", `pool:${OCTOBER}`], failed: [] });
    const [season, pool] = sent.map((s) => s.body);
    expect(season.content).toBe("📺 **Season 2: Classic Botchelor is on.**");
    expect(season.embeds[0].description).toContain("🗳️ Picked by the viewers: **Classic Botchelor**, 3 of 4 votes.");
    expect(pool.content).toBe("🏆 **The October 2026 pool is out.**");
    expect(pool.embeds[0].url).toBe(`${SITE}/seasons/october-2026?utm_source=discord&utm_medium=board&utm_campaign=pool_reveal#pool`);
    expect(pool.embeds[0].description).toBe("**1.** Ana: 40 pts\n**2.** A viewer: 30 pts\n**2.** An AI agent: 30 pts\n\n3 players. Names show only for people who put one up.");

    // Two days on, neither is news any more.
    expect(duePosts(new Date("2026-11-03T00:20:00Z")).map((d) => d.key)).toEqual(["drops:2026-11-03T00"]);
  });
});
