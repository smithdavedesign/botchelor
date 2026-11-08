// Consistency and polish (docs/audits/2026-11-07-audit-and-benchmark.md, group D, items 14–22): the show's words as
// addresses, the bots' reviews on /agents, the Constellation's first sky, whole tiles as tap targets, plain words, the
// Companion Plan in the shop, After Dark's own gate, and /agents' counts kept.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AgeGate from "@/app/AgeGate";
import { firstSky, FIRST_SKY_PAIRS, type GraphData, type GraphEdge, type GraphNode } from "@/lib/graph";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { ORIGIN_LABEL } from "@/lib/origin";
import { signAdult, verifyAdult } from "@/lib/place";
import { setSharedCacheForTests, sharedStale } from "@/lib/shared-cache";
import { SHOW_WORD_REDIRECTS } from "@/lib/site-redirects";
import { api, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

const SECRET = ["polish", "test", "secret", "0123456789abcdef"].join("-");

describe("the show's words as addresses (item 14)", () => {
  it("sends /reels, /seasons and /messages where the tabs and nav mean", () => {
    expect(SHOW_WORD_REDIRECTS.map((r) => `${r.source} → ${r.destination}`)).toEqual(["/reels → /showcase", "/seasons → /reunion", "/messages → /matches"]);
    expect(SHOW_WORD_REDIRECTS.every((r) => r.permanent === false)).toBe(true);
  });
});

describe("the Constellation opens on its strongest pairs (item 17)", () => {
  const node = (id: string): GraphNode => ({ id, name: id, hue: null, origin: "person", portrait: null, private: false, degree: 1, kind: null, kind_label: null, community: 0 });
  const edge = (a: string, b: string, weight: number, extra: Partial<GraphEdge> = {}): GraphEdge => ({
    a_id: a,
    b_id: b,
    masked: false,
    dates: 1,
    second_dates: 0,
    stage: null,
    last_at: "2026-11-01T00:00:00.000Z",
    weight,
    first_at: null,
    turned_down: null,
    left_first: null,
    met_via: null,
    ...extra,
  });
  const sky = (pairs: number): GraphData => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < pairs; i++) {
      nodes.push(node(`a${i}`), node(`b${i}`));
      edges.push(edge(`a${i}`, `b${i}`, i / pairs));
    }
    nodes.push(node("single"));
    return { nodes, edges, stats: { characters: nodes.length } as GraphData["stats"], kinds: [] };
  };

  it("keeps the strongest ties and only their characters, with the whole sky's numbers", () => {
    const whole = sky(80);
    // A masked pair between two kept characters stays (faint, as on the full sky); one to an outsider doesn't.
    whole.edges.push(edge("a79", "b78", 0.15, { masked: true }), edge("a79", "a0", 0.15, { masked: true }));
    const first = firstSky(whole);
    const open = first.edges.filter((e) => !e.masked);
    expect(open).toHaveLength(FIRST_SKY_PAIRS);
    expect(Math.min(...open.map((e) => e.weight))).toBeGreaterThanOrEqual(50 / 80);
    expect(first.nodes).toHaveLength(FIRST_SKY_PAIRS * 2);
    expect(first.nodes.some((n) => n.id === "single")).toBe(false);
    expect(first.edges.some((e) => e.masked && e.a_id === "a79" && e.b_id === "b78")).toBe(true);
    expect(first.edges.some((e) => e.a_id === "a79" && e.b_id === "a0")).toBe(false);
    expect(first.stats).toBe(whole.stats);
  });

  it("is the whole sky when that's small already", () => {
    const small = sky(10);
    expect(firstSky(small)).toBe(small);
  });
});

describe("numbers that may be minutes old answer at once (item 22)", () => {
  afterEach(() => setSharedCacheForTests(null));

  it("serves the kept copy and refreshes it behind the caller once it's old", async () => {
    setSharedCacheForTests(true);
    let n = 0;
    const load = vi.fn(async () => ++n);
    expect(await sharedStale("k", load, 1000, 0)).toBe(1);
    expect(await sharedStale("k", load, 1000, 500)).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
    // Old: still the kept copy now, a fresh one for the next caller.
    expect(await sharedStale("k", load, 1000, 5000)).toBe(1);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(load).toHaveBeenCalledTimes(2);
    expect(await sharedStale("k", load, 1000, Date.now())).toBe(2);
  });

  it("keeps the old copy when a refresh fails, and never keeps a failed first load", async () => {
    setSharedCacheForTests(true);
    await expect(sharedStale("bad", async () => Promise.reject(new Error("db down")), 1000, 0)).rejects.toThrow("db down");
    expect(await sharedStale("bad", async () => 7, 1000, 0)).toBe(7);
    expect(await sharedStale("bad", async () => Promise.reject(new Error("db down")), 1000, 9999)).toBe(7);
    await new Promise((r) => setTimeout(r, 0));
    expect(await sharedStale("bad", async () => 8, 1000, 10000)).toBe(7);
  });
});

describe("plain words on the first screens (item 19)", () => {
  it("says who made a character without jargon", () => {
    expect(ORIGIN_LABEL.agent).toBe("🤖 Made by an AI agent");
  });
});

describe("After Dark's own gate (item 21)", () => {
  it("says plainly that After Dark is explicit, in its own name", () => {
    const html = renderToStaticMarkup(createElement(AgeGate, { from: "/after-dark", afterDark: true }));
    expect(html).toContain("Botchelor After Dark");
    expect(html).toContain("After Dark is <strong>explicit</strong>");
    expect(html).not.toContain("comedic blind-date show");
    const show = renderToStaticMarkup(createElement(AgeGate, { from: "/" }));
    expect(show).toContain("comedic blind-date show");
    expect(show).not.toContain("explicit");
  });

  it("hands the show's 18+ answer across only to the browser it was minted for, and only for a minute", () => {
    const env = { SESSION_SECRET: SECRET };
    const now = Date.parse("2026-11-08T12:00:00Z");
    const token = signAdult(env, now, "nonce-a")!;
    expect(verifyAdult(token, env, now, "nonce-a")).toBe(true);
    expect(verifyAdult(token, env, now, "nonce-b")).toBe(false);
    expect(verifyAdult(token, env, now + 61_000, "nonce-a")).toBe(false);
    expect(verifyAdult(token.replace(/.$/, (c) => (c === "A" ? "B" : "A")), env, now, "nonce-a")).toBe(false);
    expect(verifyAdult(token, { SESSION_SECRET: `${SECRET}-other` }, now, "nonce-a")).toBe(false);
    expect(signAdult({}, now, "nonce-a")).toBeNull();
  });
});

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** A public date that has aired between a person's character and a house character. */
async function airedDate() {
  const owner = newUserCookie();
  const character = (await (await api.createCharacter(validCharacter({ name: "Pell Ardent" }), owner)).json()).id;
  scriptOutcome({ ending: "second_date" });
  scriptedModel([episodeJson()]);
  const ep = await (await api.createEpisode({ character_id: character, partner_id: HOUSE_CHARACTERS[0].id }, owner)).json();
  expect((await api.reveal(ep.id, owner)).status).toBeLessThan(300);
  await t.db.query(`update episodes set visibility = 'public' where id = $1`, [ep.id]);
  return { owner, character: character as string, id: ep.id as string };
}

describe("the bots' reviews moved to /agents (item 16)", () => {
  it("leaves the home page, and opens on /agents with the way to all of them", async () => {
    const Home = (await import("@/app/page")).default;
    const home = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }));
    expect(home).not.toContain("What the bots are saying");
    const Agents = (await import("@/app/agents/page")).default;
    const agents = renderToStaticMarkup(await Agents());
    expect(agents).toContain("What the bots are saying");
    expect(agents).toContain('href="/reviews"');
  });

  it("names the Constellation in plain words on the home page", async () => {
    const Home = (await import("@/app/page")).default;
    const home = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }));
    expect(home).toContain("The Constellation: a map of who&#x27;s dated whom");
    expect(home).not.toContain("Explore the Constellation");
  });
});

describe("whole tiles are the tap target (item 18)", () => {
  it("makes a pair's whole row on /characters the link to the couple", async () => {
    const { character } = await airedDate();
    const Characters = (await import("@/app/characters/page")).default;
    const html = renderToStaticMarkup(await Characters({ searchParams: Promise.resolve({ tab: "cast" }) } as never));
    expect(html).toContain('class="card graph-row tap-card"');
    expect(html).toMatch(new RegExp(`class="pair-link stretch" href="/couples/[^"]*${character}`));
  });
});

describe("the shop lists the Companion Plan (item 20)", () => {
  it("shows its card while companions are open and the plan has its link, and not otherwise", async () => {
    const Shop = (await import("@/app/shop/page")).default;
    const without = renderToStaticMarkup(await Shop({ searchParams: Promise.resolve({}) }));
    expect(without).not.toContain('data-shop-plan="companion"');
    vi.stubEnv("COMPANION_OPEN", "1");
    vi.stubEnv("COMPANION_PLAN_LINK", "https://buy.stripe.com/plan_for_tests");
    const html = renderToStaticMarkup(await Shop({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('data-shop-plan="companion"');
    expect(html).toContain("Companion Plan");
    expect(html).toContain('href="/companion/plan"');
  });
});

describe("After Dark's host asks in its own words (item 21)", () => {
  it("draws After Dark's own question there, with nothing of the show behind it", async () => {
    await airedDate();
    vi.stubEnv("AFTER_DARK_ORIGIN", "https://ad.botchelor.com");
    vi.stubEnv("AFTER_DARK_ONLY", "1");
    vi.stubEnv("SITE_URL", "https://botchelor.com");
    const GatePage = (await import("@/app/gate/page")).default;
    const html = renderToStaticMarkup(await GatePage({ searchParams: Promise.resolve({ from: "/after-dark" }) }));
    expect(html).toContain("After Dark is <strong>explicit</strong>");
    expect(html).not.toContain("gate-backdrop");
    expect(html).not.toContain("Send your OC on a blind date");
  });
});
