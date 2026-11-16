import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as marketingPost } from "@/app/api/admin/marketing/route";
import MarketingPage from "@/app/marketing/page";
import { clearMarketingCache, cleanFeed, creditPosts, loadFeed, publicMarketing, type Arrival, type MarketingPost } from "@/lib/public-marketing";
import { PUBLIC_PATHS } from "@/lib/site";
import { BASE_URL, startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  clearMarketingCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const post = (over: Partial<MarketingPost>): MarketingPost => ({
  id: "p1", at: "2026-11-10T12:00:00.000Z", channel: "mcp", channel_name: "r/mcp", type: "post", title: "A post", url: null, status: "live",
  score: null, comments: null, source: "reddit", content: "mcp", note: null, ...over,
});
const arrival = (over: Partial<Arrival>): Arrival => ({
  source: "reddit", content: "mcp", first_at: "2026-11-11T12:00:00.000Z", created: false, started: false, watched: false, signed_up: false, ...over,
});

const FEED = {
  channels: [
    { id: "mcp", name: "r/mcp", kind: "reddit", status: "active", url: "https://www.reddit.com/r/mcp/", cadence: "every 2 weeks", note: "Showcase flair", secret: "x" },
    { id: "uneed", name: "Uneed", kind: "listing", status: "waiting", url: "javascript:alert(1)" },
    { id: "mcp", name: "duplicate", kind: "reddit", status: "active" },
  ],
  posts: [
    { id: "q-4", at: "2026-11-10T12:00:00Z", channel: "mcp", channel_name: "r/mcp", type: "post", title: "Built a show", url: "https://www.reddit.com/r/mcp/comments/1/x/", status: "live", score: 12, comments: 3, source: "reddit", content: "mcp", note: "mail me at someone@example.com" },
    { id: "q-5", at: "2026-11-12T12:00:00Z", channel: "uneed", channel_name: "Uneed", type: "listing", title: "Listing", url: "https://www.uneed.best/tool/botchelor", status: "scheduled", source: "uneed" },
    { id: "bad", at: "not a date", channel: "mcp" },
  ],
  spend: [
    { what: "Uneed fast-track", usd: 19.99, status: "planned", note: "about two weeks instead of June" },
    { what: "nothing", usd: -5 },
  ],
};

describe("the marketing log (lib/public-marketing.ts)", () => {
  it("keeps only known fields, takes emails and unsafe links out, and drops duplicates and broken rows", () => {
    const f = cleanFeed(FEED, new Date("2026-11-15T00:00:00Z"))!;
    expect(f.channels.map((c) => c.id)).toEqual(["mcp", "uneed"]);
    expect(f.channels[0]).not.toHaveProperty("secret");
    expect(f.channels[1].url).toBeNull();
    expect(f.posts.map((p) => p.id)).toEqual(["q-5", "q-4"]);
    expect(f.posts[1].note).toBe("mail me at [email removed]");
    expect(f.spend).toEqual([{ what: "Uneed fast-track", usd: 19.99, status: "planned", note: "about two weeks instead of June" }]);
    expect(cleanFeed({ posts: [] })).toBeNull();
  });

  it("credits a visitor to the newest earlier post on the channel, within 30 days, matching the link's tag", () => {
    const posts = [post({ id: "old", at: "2026-11-01T00:00:00Z" }), post({ id: "new", at: "2026-11-10T00:00:00Z" }), post({ id: "x", source: "bluesky", content: "bluesky" })];
    const { byPost, bySource } = creditPosts(posts, [
      arrival({ first_at: "2026-11-05T00:00:00Z", created: true }),
      arrival({ first_at: "2026-11-11T00:00:00Z", started: true }),
      arrival({ first_at: "2026-11-11T00:00:00Z", content: "other_sub" }),
      arrival({ first_at: "2026-12-30T00:00:00Z" }),
      arrival({ source: "google", content: null }),
    ]);
    expect(byPost.get("old")).toMatchObject({ visitors: 1, created: 1 });
    expect(byPost.get("new")).toMatchObject({ visitors: 1, started: 1 });
    expect(byPost.has("x")).toBe(false);
    expect(bySource.get("reddit")?.visitors).toBe(4);
    expect(bySource.get("google")?.visitors).toBe(1);
  });

  it("stores what the loop sends (admin only) and reads visits from the site's own log", async () => {
    const send = (headers: Record<string, string>) =>
      marketingPost(new Request(`${BASE_URL}/api/admin/marketing`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(FEED) }));
    expect((await send({})).status).toBe(403);
    vi.stubEnv("FRONTIER_PASSWORD", "pw-marketing");
    const r = await send({ "x-frontier-key": "pw-marketing" });
    expect(await r.json()).toMatchObject({ ok: true, channels: 2, posts: 2, spend: 1 });
    expect((await loadFeed(t.db))?.posts).toHaveLength(2);

    const ev = (visitor: string, at: string, event: string, source: string, content: string | null) =>
      t.db.query(`insert into web_events (at, visitor, session, event, path, source, utm_content) values ($1, $2, $2, $3, '/', $4, $5)`, [at, visitor, event, source, content]);
    await ev("v1", "2026-11-11T00:00:00Z", "page_view", "reddit", "mcp");
    await ev("v1", "2026-11-11T00:05:00Z", "character_created", "direct", null);
    await ev("v2", "2026-11-11T01:00:00Z", "page_view", "google", null);
    await ev("v2", "2026-11-11T01:01:00Z", "page_leave", "google", null);
    const m = await publicMarketing(t.db);
    expect(m.byPost["q-4"]).toMatchObject({ visitors: 1, created: 1 });
    expect(m.totals).toMatchObject({ posts: 1, channels: 1, visitors: 1, created: 1, spent: 0, planned: 19.99 });
    expect(m.bySource.map((s) => s.source).sort()).toEqual(["google", "reddit"]);
  });
});

describe("the /marketing page", () => {
  it("is public and shows every post, channel, source and the planned spend", async () => {
    expect(PUBLIC_PATHS).toContain("/marketing");
    vi.stubEnv("FRONTIER_PASSWORD", "pw-marketing");
    await marketingPost(new Request(`${BASE_URL}/api/admin/marketing`, { method: "POST", headers: { "content-type": "application/json", "x-frontier-key": "pw-marketing" }, body: JSON.stringify(FEED) }));
    const html = renderToStaticMarkup(await MarketingPage());
    expect(html).toContain("Marketing, in the open");
    expect(html).toContain("Built a show");
    expect(html).toContain("https://www.reddit.com/r/mcp/comments/1/x/");
    expect(html).toContain("Uneed fast-track");
    expect(html).toContain("coming soon, not paid yet");
    expect(html).not.toContain("someone@example.com");
  });

  it("says so when no log has arrived yet", async () => {
    const html = renderToStaticMarkup(await MarketingPage());
    expect(html).toContain("No posts in the log yet.");
    expect(html).toContain("Nothing spent");
  });
});
