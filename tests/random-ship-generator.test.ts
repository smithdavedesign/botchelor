/**
 * The ship tools for search (2026-11-23): the random ship generator (/tools/random-ship-generator, lib/random-ship.ts)
 * and the ship compatibility test's quick reading for two names (lib/true-love.ts), at the address the OC chemistry
 * test always had. Pinned here: a pair is a pure function of its number and the cast; the cast is the public face of
 * public characters with an aired date, never a dealbreaker; the tool is one address for search, every variant
 * noindex; two names get the playground count with its working, kept nowhere; and every ship page and result links
 * both tools.
 */
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, getAll: () => [] }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));

import { GET as chemistryCard } from "@/app/api/og/chemistry/route";
import ShipPage from "@/app/ship/[a]/[b]/page";
import ChemistryToolPage from "@/app/tools/oc-chemistry-test/page";
import ResultPage, { generateMetadata as resultMetadata } from "@/app/tools/oc-chemistry-test/result/page";
import ToolOg from "@/app/tools/random-ship-generator/opengraph-image";
import RandomShipPage, { generateMetadata as toolMetadata } from "@/app/tools/random-ship-generator/page";
import ShipNameToolPage from "@/app/tools/ship-name-generator/page";
import { CHEMISTRY_EXAMPLE, CHEMISTRY_RESULT_PATH, chemistryResultHref, namesQuery, namesResultHref, NO_DEALBREAKER_REASON, readChemistry, readNamePair } from "@/lib/chemistry-test";
import type { Db } from "@/lib/db";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { changedLandingUrls } from "@/lib/indexnow";
import { setModelForTests } from "@/lib/model";
import { firstName, loadShipCast, nextShip, RANDOM_SHIP_MAX, RANDOM_SHIP_PATH, randomShip, randomShipHref, readShipNumber, shipCast, type ShipCastMember } from "@/lib/random-ship";
import { CHARACTER_REJECTION_MESSAGES } from "@/lib/safety";
import { staticSitemap } from "@/lib/seo";
import { shipPair, shipPath } from "@/lib/ship-names";
import { PUBLIC_PATHS } from "@/lib/site";
import { compatibilityHref, FREE_TOOLS, RANDOM_SHIP_TOOL_PATH } from "@/lib/tools";
import { oneDigit, trueLove } from "@/lib/true-love";
import { proxy as middleware } from "@/proxy";
import { startTestDb } from "./helpers";

/** React escapes quotes, apostrophes and ampersands; tests compare against the plain text. */
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
function searchRecord(query: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of new URLSearchParams(query)) {
    const seen = out[k];
    out[k] = seen === undefined ? v : Array.isArray(seen) ? [...seen, v] : [seen, v];
  }
  return out;
}
const sp = (query: string) => ({ searchParams: Promise.resolve(searchRecord(query)) });
const renderTool = async (query = "") => text(renderToStaticMarkup(await RandomShipPage(sp(query))));
const renderResult = async (query: string) => text(renderToStaticMarkup(await ResultPage(sp(query))));
const renderShip = async (a: string, b: string) => text(renderToStaticMarkup(await ShipPage({ params: Promise.resolve({ a, b }) })));
/** The opening tag of the link to `href`, or "" when the page has none. */
const linkTo = (html: string, href: string) => [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]).find((a) => a.includes(`href="${href}"`)) ?? "";
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const inputNamed = (html: string, name: string) => [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0]).find((i) => i.includes(`name="${name}"`)) ?? "";
const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Sample cast only: two of them share a first name, which never makes a ship.
const CAST: ShipCastMember[] = [
  { id: "c-wren", name: "Wren Hale", traits: ["warm", "witty", "curious"], want: "Someone warm and funny", house: false, portrait: null },
  { id: "c-teo", name: "Teo Marsh", traits: ["guarded", "kind", "dry"], want: "A slow evening", house: false, portrait: null },
  { id: "c-ivy", name: "Ivy Stone", traits: ["loud", "brave", "funny"], want: "An adventure", house: true, portrait: null },
  { id: "c-wren-2", name: "Wren Abara", traits: ["shy"], want: "", house: false, portrait: null },
];
const sideName = (s: ReturnType<typeof randomShip>["a"]) => (s.kind === "cast" ? s.cast.name : s.oc.name);

const LLM_ENV = /^(LLM_|FRONTIER_|GOOGLE_API_KEY$|OPENAI_|ANTHROPIC_|AI_GATEWAY_|VERCEL_OIDC)/;
function unsetEveryModel() {
  for (const key of Object.keys(process.env)) if (LLM_ENV.test(key)) vi.stubEnv(key, undefined);
  setModelForTests({ complete: async () => { throw new Error("a ship tool called a model"); } });
  const fetchSpy = vi.fn(async () => { throw new Error("a ship tool made a network call"); });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

/** What the show's characters keep to themselves: their dealbreakers. */
const DEALBREAKERS = HOUSE_CHARACTERS.map((c) => c.dealbreaker);

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
  // Juniper and Sable's date aired, in public; Nell's with a private character aired too. Dex's hasn't aired, and his
  // date with Nell that did air is private. Two agent-made characters' date aired, which is not the sitemap's bar.
  await t.db.query(
    `insert into characters (id, owner_id, name, age, bio, traits, want, dealbreaker, visibility) values
       ('c-hidden', 'u-hidden', 'Hidden Person', 30, '', '["kind","quiet","neat"]'::jsonb, 'Tea', 'Noise', 'private')`,
  );
  await t.db.query(
    `insert into characters (id, owner_id, name, age, bio, traits, want, dealbreaker, created_via) values
       ('c-bot-1', 'u-agent', 'Orrin Vale', 30, '', '["kind","quiet","neat"]'::jsonb, 'Tea', 'Noise', 'mcp'),
       ('c-bot-2', 'u-agent', 'Pella Moss', 30, '', '["bold","loud","funny"]'::jsonb, 'Jazz', 'Rules', 'mcp')`,
  );
  const episode = (id: string, a: string, b: string, revealed: boolean, visibility: string) =>
    t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, status, visibility)
       values ($1, 'someone', $2, $3, 'a pier', '{}'::jsonb, '[]'::jsonb, '', '', 'friends', ${revealed ? "now()" : "null"}, 'ready', $4)`,
      [id, a, b, visibility],
    );
  await episode("e-aired", "house-juniper", "house-sable", true, "public");
  await episode("e-nell", "house-nell", "c-hidden", true, "public");
  await episode("e-unaired", "house-dex", "house-juniper", false, "public");
  await episode("e-private", "house-dex", "house-nell", true, "private");
  await episode("e-bots", "c-bot-1", "c-bot-2", true, "public");
});
afterAll(async () => {
  await t.close();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setModelForTests(null);
});

describe("1. a pair: a pure function of its number and the cast (lib/random-ship.ts)", () => {
  it("is the tool the hub lists, at one address", () => {
    expect(RANDOM_SHIP_TOOL_PATH).toBe(RANDOM_SHIP_PATH);
    expect(FREE_TOOLS.map((t) => t.path)).toContain(RANDOM_SHIP_PATH);
  });

  it("reads a pair's number from its address: 1 to 999, anything else the first", () => {
    expect([undefined, "", "0", "-3", "abc", "1.5", "1e3", "1234567"].map(readShipNumber)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(["1", "2", "999", "1000", "1001"].map(readShipNumber)).toEqual([1, 2, 999, 1, 2]);
    expect(readShipNumber(["7", "8"])).toBe(7);
    expect(randomShipHref(1)).toBe(RANDOM_SHIP_PATH);
    expect(randomShipHref(42)).toBe(`${RANDOM_SHIP_PATH}?pair=42`);
    expect([nextShip(1), nextShip(998), nextShip(RANDOM_SHIP_MAX)]).toEqual([2, 999, 1]);
  });

  it("gives the same pair for the same number every time, and different pairs for different numbers", () => {
    for (const n of [1, 2, 3, 17, 999]) expect(randomShip(n, CAST)).toEqual(randomShip(n, structuredClone(CAST)));
    const pairs = new Set(Array.from({ length: 60 }, (_, i) => randomShip(i + 1, CAST)).map((s) => `${sideName(s.a)} × ${sideName(s.b)}`));
    expect(pairs.size).toBeGreaterThan(40);
  });

  it("takes turns: two from the show, one from the show and an OC, two OCs; fewer from the show when there are fewer", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => randomShip(n, CAST).mode)).toEqual(["cast-cast", "cast-oc", "oc-oc", "cast-cast", "cast-oc", "oc-oc"]);
    expect([1, 2, 3].map((n) => randomShip(n, CAST.slice(0, 1)).mode)).toEqual(["cast-oc", "oc-oc", "cast-oc"]);
    expect([1, 2, 3].map((n) => randomShip(n).mode)).toEqual(["oc-oc", "oc-oc", "oc-oc"]);
    // Two of the same first name are all the show has: one of them meets an OC instead.
    expect(randomShip(1, [CAST[0], CAST[3]]).mode).toBe("cast-oc");
  });

  it("never ships a character with itself, or two with the same first name", () => {
    for (let n = 1; n <= 300; n++) {
      const s = randomShip(n, CAST);
      expect(firstName(sideName(s.a)).toLowerCase(), `pair ${n}`).not.toBe(firstName(sideName(s.b)).toLowerCase());
    }
  });

  it("keeps a shared link's pair when a new face joins the show, unless the new face wins that pair", () => {
    const newcomer: ShipCastMember = { id: "c-new", name: "Lark Finch", traits: ["bold"], want: "", house: false, portrait: null };
    for (let n = 1; n <= 300; n += 3) {
      const before = randomShip(n, CAST);
      const after = randomShip(n, [...CAST, newcomer]);
      const ids = [after.a, after.b].map((s) => (s.kind === "cast" ? s.cast.id : null));
      if (!ids.includes("c-new")) expect(after, `pair ${n}`).toEqual(before);
    }
  });

  it("names the ship with the ship name generator's best blend of their first names", () => {
    for (let n = 1; n <= 30; n++) {
      const s = randomShip(n, CAST);
      const pair = shipPair(firstName(sideName(s.a)), firstName(sideName(s.b)));
      expect(s.ships, `pair ${n}`).toEqual(pair.ok ? pair.names : []);
    }
  });

  it("never reads a show character's dealbreaker, and never says whether one comes up", () => {
    for (let n = 1; n <= 120; n++) {
      const s = randomShip(n, CAST);
      if (s.mode === "oc-oc") continue;
      expect(s.chemistry.reasons, `pair ${n}`).not.toContain(NO_DEALBREAKER_REASON);
      // Two from the show: neither has a dealbreaker here, so no reason can name one.
      if (s.mode === "cast-cast") for (const r of s.chemistry.reasons) expect(r, `pair ${n}`).not.toMatch(/dealbreaker/i);
    }
  });

  it("leads into the show: two from the show to their ship page, an OC to /create with the OC in, two OCs to the full reading", () => {
    const castPair = randomShip(1, CAST);
    const pair = shipPair(firstName(sideName(castPair.a)), firstName(sideName(castPair.b)));
    expect(pair.ok).toBe(true);
    if (pair.ok) expect(castPair.wayIn).toEqual({ kind: "ship", href: shipPath(pair.a, pair.b), label: "See their ship page" });
    expect(castPair.fullHref).toBeNull();
    const withOc = randomShip(2, CAST);
    expect(withOc.wayIn.kind).toBe("create");
    expect(withOc.wayIn.href).toMatch(/^\/create\?say=/);
    expect(withOc.wayIn.label).toMatch(/^Send \S+ on a real date$/);
    expect(withOc.fullHref).toBeNull();
    const ocs = randomShip(3, CAST);
    expect(ocs.wayIn.href).toMatch(/^\/create\?say=/);
    expect(ocs.fullHref?.startsWith(`${CHEMISTRY_RESULT_PATH}?`)).toBe(true);
    expect(readChemistry(searchRecord(ocs.fullHref!.split("?")[1]))).toMatchObject({ ok: true });
  });
});

describe("2. the cast: the public face of public characters with an aired date", () => {
  it("takes public, listed characters made by a person or the show with a public date that aired, and only their public face", async () => {
    const cast = await loadShipCast(t.db);
    expect(cast.map((c) => c.id).sort()).toEqual(["house-juniper", "house-nell", "house-sable"]);
    for (const c of cast) {
      expect(Object.keys(c).sort()).toEqual(["house", "id", "name", "portrait", "traits", "want"]);
      expect(c.traits.length).toBeGreaterThan(0);
    }
  });

  it("RANDOM_SHIP_CAST=0 pairs OCs only, without reading the database", async () => {
    vi.stubEnv("RANDOM_SHIP_CAST", "0");
    const getDb = vi.fn(async () => t.db);
    expect(await shipCast(getDb)).toEqual([]);
    expect(getDb).not.toHaveBeenCalled();
    const html = await renderTool();
    expect(html).toContain('data-mode="oc-oc"');
    expect(html).not.toContain('data-side="cast"');
  });

  it("a database that's down or slow to answer leaves the OC pairs, not an error page", async () => {
    expect(await shipCast(async () => { throw new Error("no database"); })).toEqual([]);
    const down = { query: async () => { throw new Error("connection refused"); }, exec: async () => {} } as unknown as Db;
    expect(await shipCast(async () => down)).toEqual([]);
  });
});

describe("3. the page: /tools/random-ship-generator", () => {
  it("is one address for search: its own canonical, and every query a variant search may follow but not index", async () => {
    const base = await toolMetadata(sp(""));
    expect(String(base.title)).toMatch(/^Random ship generator: /);
    expect(String(base.description)).toMatch(/random ship generator/i);
    expect(base.alternates?.canonical).toBe(RANDOM_SHIP_PATH);
    expect(base.robots).toBeUndefined();
    for (const q of ["pair=2", "pair=999", "utm_source=reddit", "pair=nope"]) {
      const m = await toolMetadata(sp(q));
      expect(m.robots, q).toEqual({ index: false, follow: true });
      expect(m.alternates?.canonical, q).toBe(RANDOM_SHIP_PATH);
    }
  });

  it("shows two of the show's characters, their ship name, their chemistry and two buttons, server-rendered", async () => {
    const html = await renderTool();
    const cast = await loadShipCast(t.db);
    const ship = randomShip(1, cast);
    expect(ship.mode).toBe("cast-cast");
    expect(html).toMatch(/<h1[^>]*>Random ship generator<\/h1>/);
    expect(html).toContain('data-pair="1"');
    expect(html).toContain('data-mode="cast-cast"');
    expect(html.match(/data-side="cast"/g)).toHaveLength(2);
    for (const side of [ship.a, ship.b]) if (side.kind === "cast") expect(html).toContain(`href="/characters/${side.cast.id}"`);
    expect(html).toContain(`data-ship-name="${ship.ships[0].name}"`);
    expect(html).toContain(`data-score="${ship.chemistry.score}"`);
    expect(html).toContain("On paper: <strong>");
    // "Another pair" is the next address; the way in is the pair's ship page. Neither is for crawlers.
    const more = linkTo(html, `${RANDOM_SHIP_PATH}?pair=2`);
    expect(more).toContain('rel="nofollow"');
    expect(html).toMatch(/>Another pair<\/a>/);
    expect(linkTo(html, ship.wayIn.href)).toContain('rel="nofollow"');
    expect(html).toContain(">See their ship page</a>");
    // A dealbreaker stays private, on every pair.
    for (let n = 1; n <= 6; n++) {
      const page = await renderTool(`pair=${n}`);
      for (const d of DEALBREAKERS) expect(page, `pair ${n}`).not.toContain(d);
    }
  });

  it("walks the pairs one address at a time, the last back to the first", async () => {
    expect(linkTo(await renderTool("pair=2"), `${RANDOM_SHIP_PATH}?pair=3`)).toContain('rel="nofollow"');
    expect(linkTo(await renderTool(`pair=${RANDOM_SHIP_MAX}`), RANDOM_SHIP_PATH)).toContain('data-track="random-ship-more"');
    expect(await renderTool("pair=1")).toBe(await renderTool(""));
  });

  it("an OC's way in is /create with the OC in it, and two OCs get the full reading too", async () => {
    const html = await renderTool("pair=3");
    expect(html).toContain('data-mode="oc-oc"');
    const create = hrefs(html).filter((h) => h.startsWith("/create?say="));
    expect(create).toHaveLength(1);
    expect(linkTo(html, create[0])).toContain('rel="nofollow"');
    const full = hrefs(html).filter((h) => h.startsWith(`${CHEMISTRY_RESULT_PATH}?`));
    expect(full).toHaveLength(1);
    expect(linkTo(html, full[0])).toContain('rel="nofollow"');
  });

  it("says it's for fun, and that the show's engine decides every ending", async () => {
    for (const q of ["", "pair=2", "pair=3"]) {
      const html = await renderTool(q);
      expect(html).toContain("For fun");
      expect(html).toContain("the date engine decides every ending");
      expect(html).not.toMatch(/predict/i);
    }
  });

  it("renders with every model variable unset: no model, no network call", async () => {
    const fetchSpy = unsetEveryModel();
    for (const q of ["", "pair=2", "pair=3"]) expect(await renderTool(q)).toContain("data-score=");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("has its own share card, a PNG", async () => {
    const res = await ToolOg();
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 8)).toEqual(PNG);
  });

  it("is in the sitemap, and open to crawlers and new visitors without the 18+ gate", () => {
    expect(PUBLIC_PATHS).toContain(RANDOM_SHIP_PATH);
    expect(staticSitemap("https://botchelor.com").map((e) => e.url)).toContain(`https://botchelor.com${RANDOM_SHIP_PATH}`);
    const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
    const googlebot = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
    for (const ua of [chrome, googlebot]) {
      const res = middleware(new NextRequest(`http://localhost:3000${RANDOM_SHIP_PATH}?pair=4`, { headers: { "user-agent": ua } }));
      expect(res.headers.get("x-middleware-next"), ua).toBe("1");
      expect(res.headers.get("location"), ua).toBeNull();
    }
  });

  it("goes to search engines through IndexNow's daily job the day after it ships, with the re-aimed test", () => {
    const base = "https://botchelor.com";
    const urls = [`${base}${RANDOM_SHIP_PATH}`, `${base}${CHEMISTRY_RESULT_PATH.replace(/\/result$/, "")}`];
    const due = changedLandingUrls(new Date("2026-11-23T14:20:00Z"), base, new Date("2026-11-24T16:20:00Z"));
    for (const url of urls) expect(due).toContain(url);
    // Not before: the job never sends a search engine to a page that isn't deployed yet.
    const early = changedLandingUrls(new Date("2026-11-22T14:20:00Z"), base, new Date("2026-11-23T16:20:00Z"));
    for (const url of urls) expect(early).not.toContain(url);
  });
});

describe("4. two names: the love calculator's quick reading (lib/true-love.ts)", () => {
  it("is the playground count, in the open: TRUE LOVE's letters counted in both names, then summed down to two digits", () => {
    const { rows, score } = trueLove("Juniper", "Dex");
    // T R U E L O V E in "juniperdex": u 1, e 2, r 1.
    expect(rows[0]).toEqual([0, 1, 1, 2, 0, 0, 0, 2]);
    for (let i = 1; i < rows.length; i++) expect(rows[i]).toEqual(rows[i - 1].slice(1).map((n, j) => oneDigit(rows[i - 1][j] + n)));
    expect(rows.at(-1)).toHaveLength(2);
    expect(score).toBe(73);
    expect([oneDigit(9), oneDigit(13), oneDigit(99), oneDigit(0)]).toEqual([9, 4, 9, 0]);
  });

  it("gives two names the same score whichever comes first, whatever the case or accents, and scores from 0 to 99", () => {
    expect(trueLove("Dex", "Juniper").score).toBe(trueLove("Juniper", "Dex").score);
    expect(trueLove("ZOË", "léo")).toEqual(trueLove("zoe", "Leo"));
    expect(trueLove("Mary-Jane", "O'Neil")).toEqual(trueLove("MaryJane", "ONeil"));
    const names = ["Juniper", "Dex", "Sable", "Nell", "Wren", "Teo", "Ivy", "Rafe", "Mira", "Lark", "Orrin", "Pella"];
    const scores = names.flatMap((a) => names.map((b) => trueLove(a, b).score));
    for (const s of scores) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(99);
    }
    expect(new Set(scores).size).toBeGreaterThan(30);
  });

  it("reads two names and nothing else; any other field is the full test's, and no name is the tool's own address", () => {
    expect(readNamePair(searchRecord(namesQuery(" Juniper ", "Dex")))).toEqual({ ok: true, a: "Juniper", b: "Dex" });
    expect(readNamePair(searchRecord(""))).toBeNull();
    expect(readNamePair(searchRecord(`${namesQuery("Juniper", "Dex")}&a_want=Tea`))).toBeNull();
    expect(readNamePair(searchRecord("a_name=Juniper"))).toMatchObject({ ok: false, error: { kind: "invalid", side: "b", message: "Required." }, form: { a_name: "Juniper" } });
    expect(readNamePair(searchRecord(namesQuery("A B C D E F", "Dex")))).toMatchObject({ ok: false, error: { kind: "invalid", side: "a" } });
    expect(readNamePair(searchRecord(namesQuery("Elon Musk", "Dex")))).toMatchObject({ ok: false, error: { kind: "rejected", side: "a", reason: "real_person" }, form: { b_name: "Dex" } });
    // Two names that are fine apart and a real person together.
    expect(readNamePair(searchRecord(namesQuery("Taylor", "Swift")))).toMatchObject({ ok: false, error: { kind: "rejected", side: "b", reason: "real_person" }, form: { a_name: "Taylor" } });
  });

  it("shows the score, every row of the working and a link to share, and stays out of search", async () => {
    const query = namesQuery("Juniper", "Dex");
    const html = await renderResult(query);
    expect(html).toMatch(/<h1[^>]*>Juniper × Dex<\/h1>/);
    expect(html).toContain('data-score="73"');
    expect(html).toContain('data-mode="names"');
    expect(html.match(/class="true-love-row[^"]*"/g)).toHaveLength(1 + trueLove("Juniper", "Dex").rows.length);
    expect(html).toContain(`value="${namesResultHref("Juniper", "Dex")}"`);
    expect(html).toContain("just for fun");
    expect(html).not.toContain("On paper");
    expect(await renderResult(query)).toBe(html);
    const meta = await resultMetadata(sp(query));
    expect(String(meta.title)).toBe("Juniper × Dex: 73% on the love calculator · Botchelor");
    expect(meta.alternates?.canonical).toBe(namesResultHref("Juniper", "Dex"));
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(JSON.stringify(meta.openGraph?.images)).toContain(`/api/og/chemistry?${query}`);
  });

  it("asks for who they are next, with the two names already in the full test", async () => {
    const html = await renderResult(namesQuery("Juniper", "Dex"));
    expect(attr(inputNamed(html, "a_name"), "value")).toBe("Juniper");
    expect(attr(inputNamed(html, "b_name"), "value")).toBe("Dex");
    expect(attr(inputNamed(html, "a_trait1"), "value") ?? "").toBe("");
    // Its way into the show is the builder as it is: two typed names don't go anywhere else.
    expect(hrefs(html)).toContain("/create");
    expect(hrefs(html).filter((h) => h.startsWith("/create?"))).toEqual([]);
  });

  it("refuses a real person, or one split across the two names, with the builder's message, echoing neither", async () => {
    for (const [a, b, gone] of [
      ["Elon Musk", "Dex", "musk"],
      ["Taylor", "Swift", "swift"],
    ]) {
      const html = await renderResult(namesQuery(a, b));
      expect(html).toContain(CHARACTER_REJECTION_MESSAGES.real_person);
      expect(html).not.toContain("data-score");
      expect(html.toLowerCase()).not.toContain(gone);
      const meta = await resultMetadata(sp(namesQuery(a, b)));
      expect(meta.robots).toMatchObject({ index: false, follow: false });
      expect(JSON.stringify(meta).toLowerCase()).not.toContain(gone);
    }
    // What passed stays in the form.
    expect(attr(inputNamed(await renderResult(namesQuery("Elon Musk", "Dex")), "b_name"), "value")).toBe("Dex");
  });

  it("has a share card for two names, a PNG, and the tool's own card for a refused pair", async () => {
    for (const query of [namesQuery("Juniper", "Dex"), namesQuery("Taylor", "Swift"), "a_name=Juniper"]) {
      const res = await chemistryCard(new NextRequest(`http://localhost:3000/api/og/chemistry?${query}`));
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).subarray(0, 8)).toEqual(PNG);
    }
  });
});

describe("5. the compatibility test's page: a love calculator for OCs and ships", () => {
  const renderTest = () => text(renderToStaticMarkup(createElement(ChemistryToolPage)));

  it("answers what people ask, in the page and in its FAQPage data alike", () => {
    const raw = renderToStaticMarkup(createElement(ChemistryToolPage));
    const html = text(raw);
    const ld = [...raw.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].flatMap((m) => [JSON.parse(m[1])].flat()) as Record<string, unknown>[];
    const faq = ld.find((d) => d["@type"] === "FAQPage");
    expect(faq).toBeTruthy();
    expect(faq!.mainEntity).toHaveLength(4);
    for (const q of faq!.mainEntity as { name: string; acceptedAnswer: { text: string } }[]) {
      expect(html).toContain(`<h3>${q.name}</h3>`);
      expect(html).toContain(q.acceptedAnswer.text);
    }
    expect(html).toContain("It isn't a forecast");
    expect(html).toContain("Nothing goes into a database or an account");
  });

  it("puts the quick form first, and a way to a random pair", () => {
    const html = renderTest();
    expect(html.indexOf('name="a_name"')).toBeLessThan(html.indexOf('name="a_trait1"'));
    expect(html).toContain(`href="${RANDOM_SHIP_PATH}"`);
    // The example result is a full one, and it reads back.
    expect(html).toContain(`href="${chemistryResultHref(...CHEMISTRY_EXAMPLE)}"`);
  });

  it("calls the full result's ending what it is, an ending on paper, and links both ship tools from it", async () => {
    const query = chemistryResultHref(...CHEMISTRY_EXAMPLE).split("?")[1];
    const html = await renderResult(query);
    expect(html).toContain("On paper: <strong>");
    expect(html).not.toMatch(/predicted/i);
    expect(html).toContain("the engine decides how it ends");
    const ship = shipPair("Juniper", "Dex");
    expect(ship.ok).toBe(true);
    if (ship.ok) expect(linkTo(html, shipPath(ship.a, ship.b))).toContain('rel="nofollow"');
    expect(linkTo(html, RANDOM_SHIP_PATH)).not.toContain("nofollow");
  });
});

describe("6. every ship page and the ship name generator lead to the other ship tools", () => {
  it("a pair's ship page links the pair's compatibility (not for crawlers) and a random ship", async () => {
    expect(compatibilityHref("Juniper", "Dex")).toBe(namesResultHref("Juniper", "Dex"));
    expect(compatibilityHref("Mary Jane", "Dex")).toBe(namesResultHref("Mary Jane", "Dex"));
    const html = await renderShip("juniper", "dex");
    const compat = linkTo(html, namesResultHref("Juniper", "Dex"));
    expect(compat).toContain('rel="nofollow"');
    expect(html).toContain("How compatible are Juniper and Dex?");
    expect(linkTo(html, RANDOM_SHIP_PATH)).not.toContain("nofollow");
    // A refused pair links neither.
    const refused = await renderShip("elon-musk", "dex");
    expect(hrefs(refused).filter((h) => h.startsWith(CHEMISTRY_RESULT_PATH))).toEqual([]);
  });

  it("the ship name generator points to the random ship generator", () => {
    const html = text(renderToStaticMarkup(createElement(ShipNameToolPage)));
    expect(linkTo(html, RANDOM_SHIP_PATH)).toBeTruthy();
  });
});
