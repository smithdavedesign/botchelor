import { NextRequest } from "next/server";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The share card's route renders through next/og. This keeps the real renderer (so the PNG is real) and records the
// element it was given, so a test can read the card's words: Satori draws text as shapes, not as text in the PNG.
const og = vi.hoisted(() => ({ elements: [] as unknown[] }));
vi.mock("next/og", async (importOriginal) => {
  const real = await importOriginal<typeof import("next/og")>();
  class RecordingImageResponse extends real.ImageResponse {
    constructor(...args: ConstructorParameters<typeof real.ImageResponse>) {
      og.elements.push(args[0]);
      super(...args);
    }
  }
  return { ...real, ImageResponse: RecordingImageResponse };
});

// The episode page reads its viewer from next/headers: nobody (a logged-out visitor) unless a test signs one in.
const viewer = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name in viewer.cookies ? { name, value: viewer.cookies[name] } : undefined),
    has: (name: string) => name in viewer.cookies,
    getAll: () => Object.entries(viewer.cookies).map(([name, value]) => ({ name, value })),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));

import { GET as getCard } from "@/app/api/og/episode/[id]/route";
import EpisodePage, { generateMetadata } from "@/app/episodes/[id]/page";
import { beaconRef, configureFunnel, sendFunnel, SIGNAL_URL } from "@/app/funnel";
import { detectBot } from "@/lib/bots";
import { blueskyShareUrl, redditShareUrl, SHARE_DESCRIPTION_MAX, shareDescription, sharedEpisodePath } from "@/lib/episode-share";
import { ENDING_LABELS, ENDINGS, type Ending } from "@/lib/rules";
import { middleware } from "@/middleware";
import { api, BASE_URL, named, newUserCookie, setupEpisode, setupPairedEpisode, startTestDb, userIdOf } from "./helpers";

const SITE = "https://botchelor.com";
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

/** React escapes quotes, apostrophes and ampersands; tests compare against the plain text. */
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const card = (id: string) => getCard(new Request(`${BASE_URL}/api/og/episode/${id}`), { params: Promise.resolve({ id }) });

/** Renders the episode's share card and returns the words on it (the element next/og drew, as markup). */
async function cardWords(id: string): Promise<string> {
  og.elements.length = 0;
  const res = await card(id);
  expect(res.status).toBe(200);
  await res.arrayBuffer(); // reading the body is what runs the render
  expect(og.elements).toHaveLength(1);
  return text(renderToStaticMarkup(og.elements[0] as ReactElement));
}

/** The episode page as `cookie`'s browser sees it (no cookie: a logged-out visitor), as HTML. */
async function renderEpisode(id: string, cookie?: string): Promise<string> {
  viewer.cookies = cookie ? Object.fromEntries([cookie.split("=") as [string, string]]) : {};
  const page = await EpisodePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
  return text(renderToStaticMarkup(page));
}

const meta = (id: string) => generateMetadata({ params: Promise.resolve({ id }) });

/** The og:image URL(s) in a page's metadata, as strings. */
function imageUrls(images: unknown): string[] {
  return [images].flat().filter(Boolean).map((img) => (typeof img === "string" || img instanceof URL ? String(img) : String((img as { url: string | URL }).url)));
}

/** Every way an ending can be written: the stored value and its label, e.g. "friends" and "Just friends". */
const endingWords = (ending: Ending) => [ending, ending.replace("_", " "), ENDING_LABELS[ending]].map((w) => w.toLowerCase());

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  viewer.cookies = {};
});

describe("1. GET /api/og/episode/{id}: the episode's share card", () => {
  it("answers 200 with a 1200×630 PNG for an existing episode", async () => {
    const { episode } = await setupEpisode("friends");
    const res = await card(episode.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const png = Buffer.from(await res.arrayBuffer());
    expect(png.subarray(0, 8)).toEqual(PNG_MAGIC);
    // The IHDR chunk: width and height, big-endian, right after the signature and the chunk header.
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });

  it("answers 404 for an unknown id, and for a private or a hidden (reported) episode, which nobody may unfurl", async () => {
    expect((await card("no-such-episode")).status).toBe(404);

    const { creator, episode } = await setupEpisode("friends");
    await api.setVisibility(episode.id, "private", creator);
    expect((await card(episode.id)).status).toBe(404);

    const reported = (await setupEpisode("disaster")).episode;
    for (let i = 0; i < 3; i++) await api.report({ episode_id: reported.id, reason: "other" }, newUserCookie());
    expect((await api.getEpisode(reported.id, newUserCookie())).status).toBe(404); // hidden for spectators
    expect((await card(reported.id)).status).toBe(404);
  });

  it("is a poll: both characters, 'How does it end?' and the three endings to pick from", async () => {
    const { episode } = await setupEpisode("friends");
    const words = await cardWords(episode.id);
    expect(words).toContain("Mira Quell");
    expect(words).toContain("Rafe Calloway");
    expect(words).toContain("How does it end?");
    for (const ending of ENDINGS) expect(words).toContain(ENDING_LABELS[ending]);
  });

  it("gives nothing away: an unaired card reads the same whatever the ending is", async () => {
    const { episode } = await setupEpisode("friends");
    const before = await cardWords(episode.id);
    await t.db.query(`update episodes set ending = 'disaster' where id = $1`, [episode.id]);
    expect(await cardWords(episode.id)).toBe(before);
    expect(before).not.toMatch(/Ending:/);
  });

  it("stays spoiler-free once the finale airs too: it never marks the right answer", async () => {
    const { creator, episode } = await setupEpisode("second_date");
    await api.reveal(episode.id, creator);
    const words = await cardWords(episode.id);
    expect(words).toContain("How does it end?");
    expect(words).not.toMatch(/Ending:/);
    // Each ending appears once, as an option, and no option is singled out.
    for (const ending of ENDINGS) expect(words.split(ENDING_LABELS[ending]).length - 1).toBe(1);
  });

  it("can be cached briefly at the edge, so every unfurl isn't a database read", async () => {
    const { episode } = await setupEpisode("friends");
    expect((await card(episode.id)).headers.get("cache-control")).toMatch(/s-maxage=\d+/);
  });
});

describe("2. the episode page's head: og:image is the share card, a large Twitter card, a no-spoiler description", () => {
  it("points og:image and twitter:image at /api/og/episode/{id}, with twitter:card summary_large_image", async () => {
    const { episode } = await setupEpisode("friends");
    const m = await meta(episode.id);
    const og = imageUrls(m.openGraph?.images);
    expect(og).toHaveLength(1);
    expect(new URL(og[0], SITE).pathname).toBe(`/api/og/episode/${episode.id}`);
    expect(m.openGraph).toMatchObject({ siteName: "Botchelor" });
    expect(m.twitter).toMatchObject({ card: "summary_large_image" });
    expect(imageUrls((m.twitter as { images?: unknown } | undefined)?.images).map((u) => new URL(u, SITE).pathname)).toEqual([`/api/og/episode/${episode.id}`]);
  });

  it.each(ENDINGS)("an unaired %s episode: og:description says 'Guess how it ends' and never names its ending", async (ending) => {
    const { episode } = await setupEpisode(ending);
    const m = await meta(episode.id);
    for (const description of [m.openGraph?.description, m.twitter?.description, m.description]) {
      expect(description).toContain("Guess how it ends");
      for (const word of endingWords(ending)) expect(String(description).toLowerCase()).not.toContain(word);
    }
    expect(String(m.openGraph?.title)).toContain("Mira Quell");
  });

  it("keeps the description spoiler-free after the finale airs, so a shared link still asks the question", async () => {
    const { creator, episode } = await setupEpisode("disaster");
    await api.reveal(episode.id, creator);
    const m = await meta(episode.id);
    expect(m.openGraph?.description).toContain("Guess how it ends");
    for (const word of endingWords("disaster")) expect(String(m.openGraph?.description).toLowerCase()).not.toContain(word);
  });

  it("keeps the 'Guess how it ends' line even when the setting is long", async () => {
    const { episode } = await setupEpisode("friends", {}, { setting: `A night market ${"with one more lantern ".repeat(20)}and a fortune teller.` });
    const description = String((await meta(episode.id)).openGraph?.description);
    expect(description).toContain("Guess how it ends");
    expect(description.length).toBeLessThanOrEqual(200);
  });

  it("gives an unknown episode no share card and no description of it", async () => {
    const m = await meta("no-such-episode");
    expect(imageUrls(m.openGraph?.images).join()).not.toContain("/api/og/episode/");
    expect(m.robots).toMatchObject({ index: false });
  });
});

describe("3. no creator's account name or email on the card or in the tags before both agree to the reveal", () => {
  /** Two creators with display names, handles and emails, on one blind date neither has agreed to reveal. */
  async function pairWithAccounts() {
    const pair = await setupPairedEpisode();
    const people = [
      { cookie: pair.host, name: "Ottilie Brask", handle: "otti_draws", email: ["ottilie.brask", "example.org"].join("@") },
      { cookie: pair.partner, name: "Marrow Fenwick", handle: "marrowfen", email: ["marrow.fenwick", "example.net"].join("@") },
    ];
    // The shared reset leaves accounts and email preferences alone: clear this suite's own from the last test.
    await t.db.query(`delete from email_prefs where email = any($1)`, [people.map((p) => p.email)]);
    await t.db.query(`delete from accounts where handle = any($1)`, [people.map((p) => p.handle)]);
    for (const p of people) {
      await named(p.cookie, p.name);
      await t.db.query(`insert into accounts (user_id, handle, handle_display, email) values ($1, $2, $2, $3)`, [userIdOf(p.cookie), p.handle, p.email]);
      await t.db.query(`insert into email_prefs (user_id, email, status) values ($1, $2, 'on')`, [userIdOf(p.cookie), p.email]);
    }
    const secrets = people.flatMap((p) => [p.name, p.handle, p.email, p.email.split("@")[0]]).map((s) => s.toLowerCase());
    return { ...pair, people, secrets };
  }

  it("with no consent: neither the card nor the meta tags carry a creator's name, handle or email", async () => {
    const { episode, secrets } = await pairWithAccounts();
    const words = (await cardWords(episode.id)).toLowerCase();
    const tags = JSON.stringify(await meta(episode.id)).toLowerCase();
    for (const secret of secrets) {
      expect(words).not.toContain(secret);
      expect(tags).not.toContain(secret);
    }
    // The characters are public, and are on the card.
    expect(words).toContain("otto fenn");
  });

  it("with only one of the two consents: still nothing", async () => {
    const { episode, host, secrets } = await pairWithAccounts();
    expect((await api.consent(episode.id, host)).status).toBe(201);
    const words = (await cardWords(episode.id)).toLowerCase();
    const tags = JSON.stringify(await meta(episode.id)).toLowerCase();
    for (const secret of secrets) {
      expect(words).not.toContain(secret);
      expect(tags).not.toContain(secret);
    }
  });

  it("(the setup is real: once both agree, the episode itself names them, so the card's silence is a choice)", async () => {
    const { episode, host, partner } = await pairWithAccounts();
    await api.consent(episode.id, host);
    await api.consent(episode.id, partner);
    const view = await (await api.getEpisode(episode.id, newUserCookie())).json();
    expect(view.creators.map((c: { name: string }) => c.name).sort()).toEqual(["Marrow Fenwick", "Ottilie Brask"]);
  });
});

describe("4. share links: Reddit, Bluesky and Copy link, every one carrying ?ref=share", () => {
  /** The share targets on a rendered episode page. */
  function shareLinks(html: string) {
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    const reddit = hrefs.find((h) => h.startsWith("https://www.reddit.com/submit?"));
    const bsky = hrefs.find((h) => h.startsWith("https://bsky.app/intent/compose?"));
    const copy = html.match(/<input[^>]*aria-label="Episode link"[^>]*>/)?.[0];
    return { hrefs, reddit, bsky, copy, copyValue: copy?.match(/value="([^"]*)"/)?.[1] };
  }

  function expectShared(html: string, id: string) {
    const shared = `${SITE}/episodes/${id}?ref=share`;
    const { reddit, bsky, copyValue } = shareLinks(html);
    expect(reddit).toBeDefined();
    expect(bsky).toBeDefined();
    expect(new URL(reddit!).searchParams.get("url")).toBe(shared);
    expect(new URL(reddit!).searchParams.get("title")).toContain("How does it end?");
    expect(new URL(bsky!).searchParams.get("text")).toContain(shared);
    expect(copyValue).toBe(`/episodes/${id}?ref=share`); // Copy link makes it absolute in the browser
    expect(html).toMatch(/<button[^>]*>Copy link<\/button>/);
    // Nothing shares the bare address any more.
    expect(html).not.toContain(`value="/episodes/${id}"`);
    for (const url of [new URL(reddit!).searchParams.get("url")!, new URL(bsky!).searchParams.get("text")!.match(/https?:\/\/\S+/)![0], copyValue!]) {
      expect(new URL(url, SITE).searchParams.get("ref")).toBe("share");
    }
    // They open in a new tab and send no referrer from us.
    for (const link of html.match(/<a[^>]*href="https:\/\/(www\.reddit\.com|bsky\.app)[^"]*"[^>]*>/g) ?? []) {
      expect(link).toContain('target="_blank"');
      expect(link).toContain('rel="noopener noreferrer"');
    }
  }

  it("a spectator on an unaired episode, beside the prediction poll", async () => {
    const { episode } = await setupEpisode("friends");
    const html = await renderEpisode(episode.id);
    expect(html).toContain("How does it end?");
    expectShared(html, episode.id);
  });

  it("a spectator after the finale airs", async () => {
    const { creator, episode } = await setupEpisode("friends");
    await api.reveal(episode.id, creator);
    expectShared(await renderEpisode(episode.id, newUserCookie()), episode.id);
  });

  it("the creator, sharing their own date before it airs", async () => {
    const { creator, episode } = await setupEpisode("friends");
    expectShared(await renderEpisode(episode.id, creator), episode.id);
  });

  it("not on a date its host took offline (private): nobody else can open it", async () => {
    const { creator, episode } = await setupEpisode("friends");
    await api.setVisibility(episode.id, "private", creator);
    const { reddit, bsky, copy } = shareLinks(await renderEpisode(episode.id, creator));
    expect([reddit, bsky, copy]).toEqual([undefined, undefined, undefined]);
  });

  it("the share text never names a creator", async () => {
    const pair = await setupPairedEpisode();
    await named(pair.host, "Ottilie Brask");
    const html = await renderEpisode(pair.episode.id);
    const { reddit, bsky } = shareLinks(html);
    expect(decodeURIComponent(`${reddit}${bsky}`)).not.toContain("Ottilie");
  });

  it("Reddit and Bluesky (and Discord, via the copied link) can read the page's tags: their fetchers skip the 18+ gate", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; redditbot/1.0; +http://www.reddit.com/feedback)",
      "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
      "Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app)",
    ]) {
      expect(detectBot(ua)?.kind, ua).toBe("social");
      const res = middleware(new NextRequest(`${BASE_URL}/episodes/abc?ref=share`, { headers: { "user-agent": ua } }));
      expect(res.headers.get("x-middleware-next"), ua).toBe("1");
    }
  });
});

describe("5. a shared link's visit is counted as ref=share, and invites the visitor to make their own", () => {
  /** A browser for app/funnel.ts: production, a real visitor, at `href`, arriving from `referrer`. */
  function browserAt(href: string, referrer = "") {
    const url = new URL(href);
    const store = () => {
      const m = new Map<string, string>();
      return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    };
    const send = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", { cookie: "", referrer });
    vi.stubGlobal("location", { origin: url.origin, pathname: url.pathname, search: url.search });
    vi.stubGlobal("navigator", { webdriver: false });
    vi.stubGlobal("sessionStorage", store());
    vi.stubGlobal("localStorage", store());
    vi.stubGlobal("fetch", send);
    configureFunnel({ production: true, consentDefault: true });
    const sent = () => send.mock.calls.map(([to, init]) => ({ url: to, body: JSON.parse(String(init.body)) }));
    return { send, sent };
  }

  it("opening /episodes/{id}?ref=share sends one `visit` to RepoHQ's beacon with ref=share", () => {
    const { sent } = browserAt(`${SITE}/episodes/ep-123?ref=share`, "https://www.reddit.com/");
    sendFunnel("visit");
    sendFunnel("visit"); // once per browser session, as before
    expect(sent()).toEqual([
      { url: SIGNAL_URL, body: { slug: "botchelor", kind: "visit", path: "/episodes/ep-123", referrer: "https://www.reddit.com/", ref: "share" } },
    ]);
  });

  it("a logged-out visitor meets the 18+ gate first: the gate keeps ?ref=share, and the gate's visit counts it", () => {
    const fresh = middleware(new NextRequest(`${BASE_URL}/episodes/ep-123?ref=share`, { headers: { "user-agent": CHROME } }));
    const from = new URL(fresh.headers.get("location")!).searchParams.get("from");
    expect(from).toBe("/episodes/ep-123?ref=share");

    const { sent } = browserAt(`${SITE}/gate?from=${encodeURIComponent(from!)}`, "https://discord.com/");
    sendFunnel("visit");
    expect(sent()[0].body).toMatchObject({ kind: "visit", path: "/episodes/ep-123", ref: "share" });
  });

  it("a visit with no tag is unchanged (no ref), and only a known tag is sent: nothing typed goes to the beacon", () => {
    const plain = browserAt(`${SITE}/episodes/ep-123`);
    sendFunnel("visit");
    expect(plain.sent()[0].body).not.toHaveProperty("ref");

    const odd = browserAt(`${SITE}/episodes/ep-123?ref=${encodeURIComponent("someone@example.org")}`);
    sendFunnel("visit");
    expect(odd.sent()[0].body).not.toHaveProperty("ref");
    expect(JSON.stringify(odd.sent())).not.toContain("someone");
  });

  it("only the visit carries the tag; activate and checkout are as before", () => {
    const { sent } = browserAt(`${SITE}/episodes/ep-123?ref=share`);
    sendFunnel("activate");
    sendFunnel("checkout");
    for (const event of sent()) expect(event.body).not.toHaveProperty("ref");
  });

  it("reads the tag from the page, or the gate's destination, safely", () => {
    expect(beaconRef("/episodes/x", "?ref=share")).toBe("share");
    expect(beaconRef("/episodes/x", "?play=1&ref=share")).toBe("share");
    expect(beaconRef("/episodes/x", "")).toBeNull();
    expect(beaconRef("/episodes/x", "?ref=SHARE")).toBeNull();
    expect(beaconRef("/gate", `?from=${encodeURIComponent("/episodes/x?ref=share")}`)).toBe("share");
    expect(beaconRef("/gate", `?from=${encodeURIComponent("/episodes/x")}&ref=share`)).toBeNull(); // the destination's tag, not the gate's
    expect(beaconRef("/gate", `?from=${encodeURIComponent("https://evil.example/?ref=share")}`)).toBeNull();
  });

  it("the page shows a logged-out visitor 'Make your own character', linking /create, above the date itself", async () => {
    const { episode } = await setupEpisode("friends");
    const html = await renderEpisode(episode.id);
    const cta = html.match(/<a[^>]*href="\/create"[^>]*>Make your own character<\/a>/);
    expect(cta).not.toBeNull();
    // Above the fold: in the episode's header, right under the matchup and before the first card (the setting).
    const at = html.indexOf(cta![0]);
    expect(at).toBeGreaterThan(html.indexOf("<h1"));
    expect(at).toBeLessThan(html.indexOf("<section"));
    expect(at).toBeLessThan(html.indexOf("The setting"));
  });

  it("the share helpers: the tag on any path, a description with no setting yet, and %20 for spaces", () => {
    expect(sharedEpisodePath("/episodes/x")).toBe("/episodes/x?ref=share");
    expect(sharedEpisodePath("/episodes/x?play=1")).toBe("/episodes/x?play=1&ref=share");
    // While a date is still being filmed its setting can be empty: no stray space, still the invitation.
    expect(shareDescription(["Mira Quell", "Rafe Calloway"], "", false)).toBe("Mira Quell meets Rafe Calloway. Guess how it ends before the finale airs, for free points.");
    const long = shareDescription(["A".repeat(40), "B".repeat(40)], "x ".repeat(200), true);
    expect(long.length).toBeLessThanOrEqual(SHARE_DESCRIPTION_MAX);
    expect(long).toContain("Guess how it ends, then watch the date.");
    for (const url of [redditShareUrl(`${SITE}/episodes/x?ref=share`, ["Mira Quell", "Rafe"]), blueskyShareUrl(`${SITE}/episodes/x?ref=share`, ["Mira Quell", "Rafe"])]) {
      expect(url).not.toContain("+");
      expect(url).toContain("Mira%20Quell");
    }
  });

  it("shows it while the date is still being filmed, too, and not to the date's own creator", async () => {
    const { creator, episode } = await setupEpisode("friends");
    expect(await renderEpisode(episode.id, creator)).not.toContain("Make your own character");
    await t.db.query(`update episodes set status = 'generating' where id = $1`, [episode.id]);
    const filming = await renderEpisode(episode.id);
    expect(filming).toMatch(/<a[^>]*href="\/create"[^>]*>Make your own character<\/a>/);
  });
});
