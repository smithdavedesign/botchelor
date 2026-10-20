import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// /create reads the viewer from next/headers (an anonymous visitor here), and its wizard asks for the router.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, getAll: () => [] }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));

import CreatePage from "@/app/create/page";
import { beaconPath, configureFunnel, sendFunnel, SIGNAL_URL } from "@/app/funnel";
import sitemap from "@/app/sitemap";
import ShipOg from "@/app/ship/[a]/[b]/opengraph-image";
import ShipPage, { generateMetadata as shipMetadata } from "@/app/ship/[a]/[b]/page";
import { GET as submitShip } from "@/app/ship/route";
import ToolOg from "@/app/tools/ship-name-generator/opengraph-image";
import ToolPage, { metadata as toolMetadata } from "@/app/tools/ship-name-generator/page";
import { setModelForTests } from "@/lib/model";
import { staticSitemap } from "@/lib/seo";
import { readName, SHIP_ERRORS, SHIP_NAME_MAX, shipNames, shipPair } from "@/lib/ship-names";
import { middleware } from "@/middleware";
import { startTestDb } from "./helpers";

const TOOL = "/tools/ship-name-generator";

/** React escapes quotes and apostrophes; tests compare against the plain text. */
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const renderTool = () => text(renderToStaticMarkup(createElement(ToolPage)));
const params = (a: string, b: string) => ({ params: Promise.resolve({ a, b }) });
const renderShip = async (a: string, b: string) => text(renderToStaticMarkup(await ShipPage(params(a, b))));
/** The ship names a result page shows, in order. */
const shownNames = (html: string) => [...html.matchAll(/data-ship-name="([^"]+)"/g)].map((m) => m[1]);

/** Whether `ship` keeps at least `n` letters in a row from `name` (case-insensitive). */
function keepsLettersOf(ship: string, name: string, n = 2): boolean {
  const s = ship.toLowerCase();
  const letters = name.toLowerCase().replace(/[^\p{L}]/gu, "");
  for (let i = 0; i + n <= letters.length; i++) if (s.includes(letters.slice(i, i + n))) return true;
  return false;
}

// Every variable that points the app at a model. The generator must never need one.
const LLM_ENV = /^(LLM_|FRONTIER_|GOOGLE_API_KEY$|OPENAI_|ANTHROPIC_|AI_GATEWAY_|VERCEL_OIDC)/;
function unsetEveryModel() {
  for (const key of Object.keys(process.env)) if (LLM_ENV.test(key)) vi.stubEnv(key, undefined);
  for (const key of ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "GOOGLE_API_KEY", "FRONTIER_LLM_API_KEY", "FRONTIER_DEFAULT"]) vi.stubEnv(key, undefined);
  // A model (or any network call) during the render would fail the test loudly.
  setModelForTests({ complete: async () => { throw new Error("the ship name generator called a model"); } });
  const fetchSpy = vi.fn(async () => { throw new Error("the ship name generator made a network call"); });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

// /create and sitemap.xml read the database: a throwaway PGlite, as in every route test.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setModelForTests(null);
});

describe("1. the tool page: /tools/ship-name-generator", () => {
  it("renders an h1 with 'Ship Name Generator' and a form with exactly two name inputs that submits to /ship", () => {
    const html = renderTool();
    expect(html).toMatch(/<h1[^>]*>[^<]*Ship Name Generator[^<]*<\/h1>/);
    const inputs = [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0]);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toContain('name="a"');
    expect(inputs[1]).toContain('name="b"');
    for (const input of inputs) {
      expect(input).toContain("required");
      expect(input).toContain(`maxLength="${SHIP_NAME_MAX}"`);
    }
    expect(html).toMatch(/<form[^>]*action="\/ship"[^>]*method="get"|<form[^>]*method="get"[^>]*action="\/ship"/);
    // Each input has a visible label.
    expect(html).toMatch(/<label[^>]*>First name/);
    expect(html).toMatch(/<label[^>]*>Second name/);
  });

  it("has a <title> with 'Ship Name Generator', a description, and a canonical link to itself", () => {
    expect(String(toolMetadata.title)).toContain("Ship Name Generator");
    expect(toolMetadata.description).toBeTruthy();
    expect(toolMetadata.alternates?.canonical).toBe(TOOL);
    expect(toolMetadata.openGraph?.title).toBeTruthy();
    expect(toolMetadata.robots).toBeUndefined(); // indexable, like the site
  });

  it("answers crawlers directly and sends a person through the 18+ gate back to the tool (a 200 either way)", () => {
    const googlebot = middleware(new NextRequest(`http://localhost:3000${TOOL}`, { headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" } }));
    expect(googlebot.headers.get("x-middleware-next")).toBe("1");
    const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
    const adult = middleware(new NextRequest(`http://localhost:3000${TOOL}`, { headers: { "user-agent": chrome, cookie: "bz_adult=1" } }));
    expect(adult.headers.get("x-middleware-next")).toBe("1");
    const fresh = middleware(new NextRequest(`http://localhost:3000${TOOL}`, { headers: { "user-agent": chrome } }));
    expect(new URL(fresh.headers.get("location")!).searchParams.get("from")).toBe(TOOL);
  });

  it("links an example result, so crawlers find a ship page from the tool", () => {
    expect(renderTool()).toContain('href="/ship/juniper/dex"');
  });

  it("only promises blends the generator really makes (the page's examples are Junipex and Dexiper)", () => {
    const html = renderTool();
    const names = shipNames("Juniper", "Dex").map((n) => n.name);
    for (const example of ["Junipex", "Dexiper"]) {
      expect(html).toContain(example);
      expect(names).toContain(example);
    }
  });
});

describe("2. submitting two names lands on a deterministic, server-rendered /ship/<a>/<b>", () => {
  it("redirects the form's GET /ship?a=Juniper&b=Dex to /ship/juniper/dex", async () => {
    const res = await submitShip(new NextRequest("http://localhost:3000/ship?a=Juniper&b=Dex"));
    expect(res.status).toBe(303);
    // Relative, so the visitor stays on the host they came in on, with its cookies.
    expect(res.headers.get("location")).toBe("/ship/juniper/dex");
  });

  it("keeps spaces and accents in a readable address, and sends an empty form back to the tool", async () => {
    const spaced = await submitShip(new NextRequest(`http://localhost:3000/ship?a=${encodeURIComponent("  Mary Jane ")}&b=Zo%C3%AB`));
    expect(decodeURIComponent(spaced.headers.get("location")!)).toBe("/ship/mary-jane/zoë");
    const empty = await submitShip(new NextRequest("http://localhost:3000/ship?a=&b="));
    expect(empty.headers.get("location")).toBe(TOOL);
  });

  it("server-renders at least 5 distinct ship names, each keeping at least 2 letters of each name, with no model and no network", async () => {
    const fetchSpy = unsetEveryModel();
    const html = await renderShip("juniper", "dex");
    const names = shownNames(html);
    expect(names.length).toBeGreaterThanOrEqual(5);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    for (const name of names) {
      expect(keepsLettersOf(name, "Juniper"), `${name} keeps 2 letters of Juniper`).toBe(true);
      expect(keepsLettersOf(name, "Dex"), `${name} keeps 2 letters of Dex`).toBe(true);
      expect(["juniper", "dex"]).not.toContain(name.toLowerCase());
    }
    expect(html).toMatch(/<h1[^>]*>Juniper × Dex/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders the same names on reload, and the same for the same address in another case", async () => {
    unsetEveryModel();
    const first = shownNames(await renderShip("juniper", "dex"));
    const again = shownNames(await renderShip("juniper", "dex"));
    expect(again).toEqual(first);
    expect(shownNames(await renderShip("Juniper", "DEX"))).toEqual(first);
    expect(shipNames("Juniper", "Dex")).toEqual(shipNames("Juniper", "Dex"));
  });

  it("decodes an encoded address (accents travel percent-encoded)", async () => {
    const names = shownNames(await renderShip("zo%C3%AB", "dex"));
    expect(names.length).toBeGreaterThanOrEqual(1);
    for (const name of names) expect(keepsLettersOf(name, "zoë")).toBe(true);
  });
});

describe("3. the result page leads to /create with the first name filled in, and shares well", () => {
  it("ends in 'Send them on a blind date', linking /create?name=Juniper, and /create's name input says Juniper", async () => {
    const html = await renderShip("juniper", "dex");
    expect(html).toContain("Send them on a blind date");
    const href = [...html.matchAll(/href="(\/create\?[^"]+)"/g)].map((m) => m[1]);
    expect(href).toEqual(["/create?name=Juniper"]);
    // Follow the link: the builder opens with the name already in.
    const query = Object.fromEntries(new URL(href[0], "http://localhost:3000").searchParams);
    const create = renderToStaticMarkup(await CreatePage({ searchParams: Promise.resolve(query) }));
    const input = create.match(/<input[^>]*name="name"[^>]*>/)?.[0] ?? "";
    expect(input).toContain('value="Juniper"');
  });

  it("leaves /create's name empty without the parameter, and caps a long one at the field's 40 characters", async () => {
    const plain = renderToStaticMarkup(await CreatePage({ searchParams: Promise.resolve({}) }));
    expect(plain.match(/<input[^>]*name="name"[^>]*>/)?.[0]).toContain('value=""');
    const long = renderToStaticMarkup(await CreatePage({ searchParams: Promise.resolve({ name: "x".repeat(80) }) }));
    expect(long.match(/<input[^>]*name="name"[^>]*>/)?.[0]).toContain(`value="${"x".repeat(40)}"`);
  });

  it("has an og:title (and twitter title) with both names, a canonical link to itself, and stays indexable", async () => {
    const meta = await shipMetadata(params("juniper", "dex"));
    const og = String(meta.openGraph?.title ?? "");
    expect(og).toContain("Juniper");
    expect(og).toContain("Dex");
    expect(String(meta.twitter?.title ?? "")).toContain("Juniper");
    expect(String(meta.title)).toContain("Juniper × Dex");
    expect(meta.alternates?.canonical).toBe("/ship/juniper/dex");
    expect(meta.robots).toBeUndefined();
  });

  it("points every case of the same pair at one canonical address", async () => {
    expect((await shipMetadata(params("JUNIPER", "Dex"))).alternates?.canonical).toBe("/ship/juniper/dex");
  });

  it("offers a copyable link to the page and a form to try another pair, filled in with these names", async () => {
    const html = await renderShip("juniper", "dex");
    expect(html).toContain('value="/ship/juniper/dex"');
    expect(html).toMatch(/<input[^>]*name="a"[^>]*value="Juniper"/);
    expect(html).toMatch(/<input[^>]*name="b"[^>]*value="Dex"/);
  });

  it("has a share card for the pair (and one for the tool) that renders to PNG", async () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const res of [await ShipOg(params("juniper", "dex")), await ShipOg(params("elon-musk", "dex")), await ToolOg()]) {
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.subarray(0, 8)).toEqual(PNG);
    }
  });
});

describe("4. real people and sexual terms get the error, no ship names, and noindex", () => {
  it.each([
    ["a real person (full name)", "elon-musk", "dex", "real_person"],
    ["a real person (one name)", "juniper", "zendaya", "real_person"],
    ["a real person split across the two names", "taylor", "swift", "real_person"],
    ["a sexual term", "juniper", "horny", "unsafe"],
    ["a sexual term, leetspeak", "p0rn", "dex", "unsafe"],
    ["a minor term", "schoolgirl", "dex", "unsafe"],
  ] as const)("%s", async (_label, a, b, error) => {
    const html = await renderShip(a, b);
    expect(html).toContain(SHIP_ERRORS[error]);
    expect(shownNames(html)).toEqual([]);
    expect(html).not.toContain("/create?name=");
    const meta = await shipMetadata(params(a, b));
    expect(meta.robots).toMatchObject({ index: false });
    // Nothing about the blocked names goes in the title or share text.
    for (const blocked of [a, b].filter((n) => n !== "juniper" && n !== "dex")) {
      expect(JSON.stringify(meta).toLowerCase()).not.toContain(blocked.split("-").at(-1));
    }
  });

  it("an invalid name (digits, one letter, too long) gets its own message, no names and noindex", async () => {
    for (const [a, b] of [["r2d2", "dex"], ["j", "dex"], ["juniper", "x".repeat(SHIP_NAME_MAX + 1)], ["-", "dex"]]) {
      const html = await renderShip(a, b);
      expect(html).toContain(SHIP_ERRORS.invalid);
      expect(shownNames(html)).toEqual([]);
      expect((await shipMetadata(params(a, b))).robots).toMatchObject({ index: false });
    }
  });

  it("never echoes a blocked name back into the form", async () => {
    const html = await renderShip("elon-musk", "dex");
    expect(html.toLowerCase()).not.toContain("musk");
  });
});

describe("5. findable and measured: the sitemap, and the beacon's visit with its path", () => {
  it("lists the tool in the sitemap (static part and the full sitemap.xml)", async () => {
    const base = "https://botchelor.com";
    expect(staticSitemap(base).map((e) => e.url)).toContain(`${base}${TOOL}`);
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    expect((await sitemap()).map((e) => e.url)).toContain(`${base}${TOOL}`);
  });

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

  it("loading the tool sends one `visit` to RepoHQ's beacon with path /tools/ship-name-generator", () => {
    const { sent } = browserAt(`https://botchelor.com${TOOL}`, "https://www.google.com/");
    sendFunnel("visit");
    sendFunnel("visit"); // once per browser session
    expect(sent()).toEqual([
      { url: SIGNAL_URL, body: { slug: "botchelor", kind: "visit", path: TOOL, referrer: "https://www.google.com/" } },
    ]);
  });

  it("a search visitor who meets the 18+ gate first still counts for the tool", () => {
    const { sent } = browserAt(`https://botchelor.com/gate?from=${encodeURIComponent(TOOL)}`, "https://www.google.com/");
    sendFunnel("visit");
    expect(sent()[0].body).toMatchObject({ kind: "visit", path: TOOL });
  });

  it("a ship page counts as /ship: the names someone typed never go to the beacon", () => {
    const { sent } = browserAt("https://botchelor.com/ship/juniper/dex");
    sendFunnel("visit");
    expect(sent()[0].body.path).toBe("/ship");
    expect(JSON.stringify(sent())).not.toContain("juniper");
  });

  it("works out the path from the page, or the gate's destination, safely", () => {
    expect(beaconPath(TOOL)).toBe(TOOL);
    expect(beaconPath("/")).toBe("/");
    expect(beaconPath("/create", "?name=Juniper")).toBe("/create");
    expect(beaconPath("/gate", `?from=${encodeURIComponent(`${TOOL}?a=1#x`)}`)).toBe(TOOL);
    expect(beaconPath("/gate", `?from=${encodeURIComponent("/ship/juniper/dex")}`)).toBe("/ship");
    expect(beaconPath("/gate", "?from=https%3A%2F%2Fevil.example")).toBe("/");
    expect(beaconPath("/gate")).toBe("/gate");
  });

  it("still sends nothing from a preview, an automated browser or the owner's browser", () => {
    const { send } = browserAt(`https://botchelor.com${TOOL}`);
    configureFunnel({ production: false, consentDefault: true });
    sendFunnel("visit");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("the generator (lib/ship-names.ts)", () => {
  it("blends the start of one name with the end of the other, both ways round", () => {
    const blends = shipNames("Juniper", "Dex");
    expect(blends.find((n) => n.name === "Junipex")).toMatchObject({ head: "Junip", tail: "ex" });
    expect(blends.find((n) => n.name === "Dexiper")).toMatchObject({ head: "Dex", tail: "iper" });
    for (const n of blends) expect(n.name.toLowerCase()).toBe(`${n.head}${n.tail}`.toLowerCase());
  });

  it("shows at most 10, best first, capitalised, never a name that is just one of the two", () => {
    for (const [a, b] of [["Juniper", "Dex"], ["Draco", "Harry"], ["Brad", "Angelina"], ["Wren", "Teo"], ["Pernilla", "Rafe"], ["Marlowe", "Nell"]]) {
      const names = shipNames(a, b).map((n) => n.name);
      expect(names.length).toBeGreaterThanOrEqual(5);
      expect(names.length).toBeLessThanOrEqual(10);
      for (const n of names) {
        expect(n[0]).toBe(n[0].toUpperCase());
        expect(n.slice(1)).toBe(n.slice(1).toLowerCase());
        expect(keepsLettersOf(n, a) && keepsLettersOf(n, b)).toBe(true);
        expect([a.toLowerCase(), b.toLowerCase()]).not.toContain(n.toLowerCase());
      }
    }
  });

  it("puts the classic blends near the top", () => {
    expect(shipNames("Draco", "Harry").slice(0, 3).map((n) => n.name)).toContain("Drarry");
    expect(shipNames("Brad", "Angelina").slice(0, 5).map((n) => n.name)).toContain("Brangelina");
  });

  it("still makes something from two-letter names", () => {
    const names = shipNames("Al", "Bo").map((n) => n.name);
    expect(names).toEqual(expect.arrayContaining(["Albo", "Boal"]));
  });

  it("blends a multi-word name from its first name", () => {
    const pair = shipPair("Mary Jane", "Peter");
    expect(pair.ok).toBe(true);
    if (!pair.ok) return;
    expect(pair.a).toMatchObject({ display: "Mary Jane", slug: "mary-jane" });
    for (const n of pair.names) expect(keepsLettersOf(n.name, "Mary") && keepsLettersOf(n.name, "Peter")).toBe(true);
  });

  it("never offers a ship name the show's filter would refuse (Selene + Roxy can't make 'Sexy')", () => {
    expect(shipNames("Selene", "Roxy").map((n) => n.name)).not.toContain("Sexy");
    for (const [a, b] of [["Selene", "Roxy"], ["Sebastian", "Lexi"], ["Porter", "Nora"], ["Tessa", "Rex"]]) {
      for (const n of shipNames(a, b)) expect(shipPair(n.name, "Dex").ok).toBe(true);
    }
  });

  it("keeps every ship name to the length a name may have, even from two long names", () => {
    const names = shipNames("Bartholomew-Maximilian", "Evangelina Wilhelmina");
    expect(names.length).toBeGreaterThanOrEqual(5);
    for (const n of names) expect(n.name.length).toBeLessThanOrEqual(SHIP_NAME_MAX);
  });

  it("reads a name from a form or an address: letters, spaces, hyphens and apostrophes, 2 to 24 characters", () => {
    expect(readName("  juniper ")).toEqual({ display: "Juniper", slug: "juniper", core: "juniper" });
    expect(readName("mary-jane")).toMatchObject({ display: "Mary Jane", slug: "mary-jane", core: "mary" });
    expect(readName("O'Brien")).toMatchObject({ display: "O'brien", slug: "o'brien", core: "obrien" });
    expect(readName("Zoë")).toEqual(readName("Zoë")); // spelled two ways below
    const precomposed = `Zo${String.fromCodePoint(0xeb)}`; // "ë" as one character
    const decomposed = `Zoe${String.fromCodePoint(0x308)}`; // "e" + a combining diaeresis
    expect(readName(decomposed)).toEqual(readName(precomposed));
    expect(readName(decomposed)).toMatchObject({ display: precomposed, slug: precomposed.toLowerCase(), core: precomposed.toLowerCase() });
    expect(readName("Zoë")?.core).toBe("zoë");
    expect(readName("Zoë")).toMatchObject({ display: "Zoë", slug: "zoë" });
    expect(readName("Zoë")?.slug).toBe("zoë");
    expect(readName("Zoë")).toEqual(readName("Zoë")); // a decomposed accent reads the same
    for (const bad of ["", " ", "j", "r2d2", "<script>", "dex!", "a/b", "x".repeat(SHIP_NAME_MAX + 1), "-", "j k"]) expect(readName(bad)).toBeNull();
  });

  it("names the reason a pair is refused", () => {
    expect(shipPair("Elon Musk", "Dex")).toEqual({ ok: false, error: "real_person" });
    expect(shipPair("Juniper", "Nsfw")).toEqual({ ok: false, error: "unsafe" });
    expect(shipPair("Juniper", "4ever")).toEqual({ ok: false, error: "invalid" });
  });
});
