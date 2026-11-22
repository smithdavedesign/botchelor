import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as marketingPost } from "@/app/api/admin/marketing/route";
import MarketingPage from "@/app/marketing/page";
import { cleanFeed, loadFeed } from "@/lib/public-marketing";
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
});
afterEach(() => {
  vi.unstubAllEnvs();
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

  it("stores what the loop sends (admin only)", async () => {
    const send = (headers: Record<string, string>) =>
      marketingPost(new Request(`${BASE_URL}/api/admin/marketing`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(FEED) }));
    expect((await send({})).status).toBe(403);
    vi.stubEnv("FRONTIER_PASSWORD", "pw-marketing");
    const r = await send({ "x-frontier-key": "pw-marketing" });
    expect(await r.json()).toMatchObject({ ok: true, channels: 2, posts: 2, spend: 1 });
    expect((await loadFeed(t.db))?.posts).toHaveLength(2);
  });
});

// The page as cut down by the 2026-11-22 audit: three numbers, the ten newest of our own posts, the channels by status
// with Reddit's communities as one line, and the money. No visitor numbers, replies, removed posts or community names.
const PAGE_FEED = {
  channels: [
    ...FEED.channels,
    { id: "x", name: "X", kind: "x", status: "active", url: "https://x.com/botchelorcom", cadence: "daily", note: null },
    { id: "chatbotrefugees", name: "r/ChatbotRefugees", kind: "reddit", status: "active", cadence: "every 6 days" },
    { id: "ai-agents", name: "r/AI_Agents", kind: "reddit-thread", status: "active", cadence: "weekly" },
    { id: "webgames", name: "r/WebGames", kind: "reddit", status: "skipped", note: "For games you play." },
    { id: "alternativeto", name: "AlternativeTo", kind: "listing", status: "skipped", note: "It declines AI companion apps." },
  ],
  posts: [
    ...FEED.posts,
    { id: "x-1", at: "2026-11-11T12:00:00Z", channel: "x", channel_name: "X", type: "video", title: "Two AI characters, one blind date", url: "https://x.com/botchelorcom/status/1", status: "live" },
    { id: "x-2", at: "2026-11-09T12:00:00Z", channel: "x", channel_name: "X", type: "post", title: "A post that was taken down", url: "https://x.com/botchelorcom/status/2", status: "removed" },
    { id: "r-1", at: "2026-11-11T13:00:00Z", channel: "chatbotrefugees", channel_name: "r/ChatbotRefugees", type: "post", title: "I'm the dev", url: "https://www.reddit.com/r/ChatbotRefugees/comments/2/x/", status: "live" },
    { id: "a-1", at: "2026-11-11T14:00:00Z", channel: "mcp", channel_name: "r/mcp", type: "answer", title: "I'd check your tool descriptions first", status: "live" },
    { id: "c-1", at: "2026-11-11T15:00:00Z", channel: "x", channel_name: "X", type: "comment", title: "Thanks!", status: "live" },
  ],
  spend: FEED.spend,
};

describe("the /marketing page", () => {
  const send = (feed: unknown) => {
    vi.stubEnv("FRONTIER_PASSWORD", "pw-marketing");
    return marketingPost(new Request(`${BASE_URL}/api/admin/marketing`, { method: "POST", headers: { "content-type": "application/json", "x-frontier-key": "pw-marketing" }, body: JSON.stringify(feed) }));
  };
  const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

  it("is public and short: three numbers, our latest posts with their links, the channels and the planned spend", async () => {
    expect(PUBLIC_PATHS).toContain("/marketing");
    await send(PAGE_FEED);
    const html = renderToStaticMarkup(await MarketingPage());
    expect(html).toContain("Marketing, in the open");
    expect(html.match(/<dt class="muted small">/g)).toHaveLength(3);
    // Posts so far: our own posts that went up (the X video, the removed X post, the Reddit posts), not replies or what's scheduled.
    expect(text(html)).toMatch(/Posts so far4/);
    expect(html).toContain("Two AI characters, one blind date");
    expect(html).toContain("https://x.com/botchelorcom/status/1");
    expect(html).toContain("Listing"); // the scheduled listing, marked as such
    expect(text(html)).toContain("Uneed · Scheduled");
    expect(html).toContain("Uneed fast-track");
    expect(html).toContain("coming soon, not paid yet");
    expect(html).not.toContain("someone@example.com");
    // Where we post: named channels with their notes, Reddit's communities counted on one line per group.
    expect(text(html)).toContain("Reddit · 3 communities, each at the pace its own rules allow");
    expect(text(html)).toContain("Reddit · 1 community, not a fit for the show, or their rules say no");
    expect(html).toContain("It declines AI companion apps.");
  });

  it("leaves out what read as nobody-here or as astroturfing: visitor numbers, replies, removed posts and community names", async () => {
    await send(PAGE_FEED);
    const html = renderToStaticMarkup(await MarketingPage());
    for (const gone of ["Visitors", "Dates they started", "Characters they made", "Removed there", "Answer", "Score there", "automated loop", "r/", "I'm the dev", "I'd check your tool", "Thanks!", "A post that was taken down", "Built a show"]) {
      expect(text(html), gone).not.toContain(gone);
    }
    expect(html).not.toContain("table-scroll");
  });

  it("says so when no log has arrived yet", async () => {
    const html = renderToStaticMarkup(await MarketingPage());
    expect(html).toContain("No posts in the log yet.");
    expect(html).toContain("Nothing spent");
    expect(html).toContain("hasn&#x27;t reached the site yet");
  });
});
