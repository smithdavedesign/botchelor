import { NextRequest } from "next/server";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// /create and the root layout read the viewer from next/headers (an anonymous visitor here); the wizard asks for the
// router, and the layout's nav for the page it's on.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, getAll: () => [] }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/create",
}));

import { GET as chemistryCard } from "@/app/api/og/chemistry/route";
import CreatePage from "@/app/create/page";
import { beaconPath, configureFunnel, sendFunnel, SIGNAL_URL } from "@/app/funnel";
import RootLayout from "@/app/layout";
import Home from "@/app/page";
import sitemap from "@/app/sitemap";
import ToolPage, { metadata as toolMetadata } from "@/app/tools/oc-chemistry-test/page";
import ResultPage, { generateMetadata as resultMetadata } from "@/app/tools/oc-chemistry-test/result/page";
import {
  CHEMISTRY_RESULT_PATH,
  CHEMISTRY_TEST_PATH,
  chemistryQuery,
  chemistryResultHref,
  chemistryTest,
  createPairHref,
  readChemistry,
  SCORE_BANDS,
  SHEET_FIELDS,
  type OcSheet,
} from "@/lib/chemistry-test";
import { deterministicEngine } from "@/lib/engine";
import { setModelForTests } from "@/lib/model";
import { ENDING_LABELS, ENDINGS, type AgendaId } from "@/lib/rules";
import { CHARACTER_REJECTION_MESSAGES } from "@/lib/safety";
import { staticSitemap } from "@/lib/seo";
import { sheetSignals } from "@/lib/temperament";
import { middleware } from "@/middleware";
import { api, newUserCookie, startTestDb, validCharacter } from "./helpers";

const TOOL = CHEMISTRY_TEST_PATH;

// Sample characters only.
const JUNIPER: OcSheet = {
  name: "Juniper",
  traits: ["curious", "warm", "dry-witted"],
  want: "Someone who gets lost on purpose",
  dealbreaker: "People who are always on their phone",
};
const DEX: OcSheet = {
  name: "Dex",
  traits: ["restless", "funny", "loyal"],
  want: "Someone curious enough to keep up",
  dealbreaker: "Cynics",
};
/** Juniper can't stand brash people, and Dex is brash. */
const JUNIPER_STRICT: OcSheet = { ...JUNIPER, dealbreaker: "Brash people" };
const DEX_BRASH: OcSheet = { ...DEX, traits: ["brash", "funny", "loyal"] };
/** Everything the engine likes about a pair, except that Wren can't stand anyone witty, and Teo is. */
const WREN: OcSheet = { name: "Wren", traits: ["warm and kind", "witty and funny", "curious, playful"], want: "Someone warm and funny", dealbreaker: "Anyone too witty" };
const TEO: OcSheet = { name: "Teo", traits: ["warm and kind", "witty and funny", "curious, playful"], want: "Someone curious", dealbreaker: "Rudeness" };

/** React escapes quotes and apostrophes; tests compare against the plain text. */
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
/** A query string as Next hands it to a page: repeated keys become arrays. */
function searchRecord(query: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of new URLSearchParams(query)) {
    const seen = out[k];
    out[k] = seen === undefined ? v : Array.isArray(seen) ? [...seen, v] : [seen, v];
  }
  return out;
}
const sp = (query: string) => ({ searchParams: Promise.resolve(searchRecord(query)) });
const renderTool = () => text(renderToStaticMarkup(createElement(ToolPage)));
const renderResult = async (query: string) => text(renderToStaticMarkup(await ResultPage(sp(query))));
const renderCreate = async (query: string) => text(renderToStaticMarkup(await CreatePage(sp(query))));
/** The query a visitor's form submits for two characters, field by field, the way the browser writes it. */
function formQuery(a: Partial<OcSheet> & { name: string }, b: Partial<OcSheet> & { name: string }, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  for (const [side, s] of [["a", a], ["b", b]] as const) {
    q.set(`${side}_name`, s.name);
    (s.traits ?? ["kind", "quiet", "brave"]).forEach((t, i) => q.set(`${side}_trait${i + 1}`, t));
    q.set(`${side}_want`, s.want ?? "A long walk");
    q.set(`${side}_dealbreaker`, s.dealbreaker ?? "Rudeness");
  }
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q.toString();
}
const inputs = (html: string) => [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0]);
const inputNamed = (html: string, name: string) => inputs(html).find((i) => i.includes(`name="${name}"`)) ?? "";
const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
/** The reasons a result page shows, in order. */
const reasonsIn = (html: string) => [...html.matchAll(/<li[^>]*data-reason[^>]*>([^<]*)<\/li>/g)].map((m) => m[1]);
const hrefsTo = (html: string, prefix: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => h.startsWith(prefix));

// Every variable that points the app at a model. The test must never need one.
const LLM_ENV = /^(LLM_|FRONTIER_|GOOGLE_API_KEY$|OPENAI_|ANTHROPIC_|AI_GATEWAY_|VERCEL_OIDC)/;
function unsetEveryModel() {
  for (const key of Object.keys(process.env)) if (LLM_ENV.test(key)) vi.stubEnv(key, undefined);
  setModelForTests({ complete: async () => { throw new Error("the chemistry test called a model"); } });
  const fetchSpy = vi.fn(async () => { throw new Error("the chemistry test made a network call"); });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

// /create, the layout and sitemap.xml read the database: a throwaway PGlite, as in every route test.
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

describe("1. the tool page: /tools/oc-chemistry-test", () => {
  it("has a <title> with 'Chemistry Test', a description and a canonical link to itself, and is indexable", () => {
    expect(String(toolMetadata.title)).toContain("Chemistry Test");
    expect(toolMetadata.description).toBeTruthy();
    expect(toolMetadata.alternates?.canonical).toBe(TOOL);
    expect(String(toolMetadata.openGraph?.title)).toContain("Chemistry Test");
    expect(toolMetadata.robots).toBeUndefined();
  });

  it("renders an h1 and one GET form for two characters, each with a name, three traits, a want and a dealbreaker", () => {
    const html = renderTool();
    expect(html).toMatch(/<h1[^>]*>[^<]*Chemistry Test[^<]*<\/h1>/);
    const forms = [...html.matchAll(/<form[^>]*>/g)].map((m) => m[0]);
    expect(forms).toHaveLength(1);
    expect(attr(forms[0], "action")).toBe(CHEMISTRY_RESULT_PATH);
    expect(attr(forms[0], "method")).toBe("get");
    const names = inputs(html).map((i) => attr(i, "name"));
    expect(names).toEqual(["a", "b"].flatMap((side) => SHEET_FIELDS.map((f) => `${side}_${f}`)));
    for (const input of inputs(html)) expect(input).toContain("required");
    // Two fieldsets, one per character, each with the builder's labels.
    expect(html.match(/<fieldset/g)).toHaveLength(2);
    for (const label of ["Name", "Three traits", "What they want from a date", "Their dealbreaker"]) {
      expect(html.split(label).length - 1, label).toBeGreaterThanOrEqual(2);
    }
  });

  it("takes each field with the same limit /create's builder does", async () => {
    const tool = renderTool();
    const create = await renderCreate("");
    for (const field of SHEET_FIELDS) {
      const builderMax = attr(inputNamed(create, field), "maxLength");
      expect(builderMax, `/create has a ${field} input`).toBeTruthy();
      for (const side of ["a", "b"]) expect(attr(inputNamed(tool, `${side}_${field}`), "maxLength"), `${side}_${field}`).toBe(builderMax);
    }
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

  it("links an example result that really is a result", async () => {
    const example = hrefsTo(renderTool(), CHEMISTRY_RESULT_PATH);
    expect(example).toHaveLength(1);
    const html = await renderResult(example[0].split("?")[1]);
    expect(reasonsIn(html)).toHaveLength(3);
  });
});

describe("2. the score: deterministic, 0–100, one of three endings, no model", () => {
  it("gives the same two characters the same score and ending every time, in either order", () => {
    const first = chemistryTest(JUNIPER, DEX);
    expect(Number.isInteger(first.score)).toBe(true);
    expect(first.score).toBeGreaterThanOrEqual(0);
    expect(first.score).toBeLessThanOrEqual(100);
    expect(ENDINGS).toContain(first.ending);
    expect(first.reasons).toHaveLength(3);
    expect(chemistryTest(JUNIPER, DEX)).toEqual(first);
    expect(chemistryTest(structuredClone(JUNIPER), structuredClone(DEX))).toEqual(first);
    const swapped = chemistryTest(DEX, JUNIPER);
    expect([swapped.score, swapped.ending]).toEqual([first.score, first.ending]);
  });

  it("keeps every score inside its ending's band", () => {
    const pairs: [OcSheet, OcSheet][] = [[JUNIPER, DEX], [JUNIPER_STRICT, DEX_BRASH], [WREN, TEO], [TEO, { ...WREN, dealbreaker: "Rudeness" }], [JUNIPER, TEO], [DEX, WREN]];
    const cold: OcSheet = { name: "Vale", traits: ["guarded", "cold", "serious"], want: "Silence", dealbreaker: "Small talk" };
    pairs.push([cold, { ...cold, name: "Ash", traits: ["cynical", "stern", "rigid"] }]);
    for (const [a, b] of pairs) {
      const { score, ending } = chemistryTest(a, b);
      const [lo, hi] = SCORE_BANDS[ending];
      expect(score, `${a.name} × ${b.name}`).toBeGreaterThanOrEqual(lo);
      expect(score, `${a.name} × ${b.name}`).toBeLessThanOrEqual(hi);
    }
  });

  it("can land on each of the three endings", () => {
    const cold: OcSheet = { name: "Vale", traits: ["guarded", "cold", "serious"], want: "Silence", dealbreaker: "Small talk" };
    const endings = new Set([
      chemistryTest(TEO, { ...WREN, dealbreaker: "Rudeness" }).ending,
      chemistryTest(cold, { ...cold, name: "Ash", traits: ["cynical", "stern", "rigid"] }).ending,
      chemistryTest(JUNIPER_STRICT, DEX_BRASH).ending,
      chemistryTest({ ...JUNIPER, traits: ["quiet", "neat", "tall"], want: "Tea" }, { ...DEX, traits: ["short", "tidy", "calm"], want: "Cake" }).ending,
    ]);
    expect([...endings].sort()).toEqual([...ENDINGS].sort());
  });

  it("calls a pair a disaster when one's dealbreaker is one of the other's traits, either way round", () => {
    expect(chemistryTest(JUNIPER_STRICT, DEX_BRASH).ending).toBe("disaster");
    expect(chemistryTest(DEX_BRASH, JUNIPER_STRICT).ending).toBe("disaster");
    // Case and plurals don't hide it: "Brash people" is a dealbreaker for anyone "BRASH".
    expect(chemistryTest(JUNIPER_STRICT, { ...DEX, traits: ["loyal", "BRASH", "funny"] }).ending).toBe("disaster");
    expect(chemistryTest({ ...JUNIPER, dealbreaker: "Liars" }, { ...DEX, traits: ["funny", "loyal", "liar"] }).ending).toBe("disaster");
    // The same pair without that dealbreaker isn't one.
    expect(chemistryTest(JUNIPER, DEX_BRASH).ending).not.toBe("disaster");
  });

  it("holds even when the engine alone would let the date off: Wren and Teo share everything but Wren's dealbreaker", () => {
    // The date engine counts a tripped dealbreaker as a heavy penalty, not a verdict: for this pair it still reaches
    // "friends" or better on some agendas. The test's rule makes it a disaster every time.
    const setup = (s: OcSheet, agendaId: AgendaId) => ({
      sheet: { ...s, age: 30, bio: "", house: false },
      signals: sheetSignals({ traits: s.traits }),
      autonomy: "guided" as const,
      strategy: "genuine_chemistry" as const,
      agendaId,
      note: null,
      gameBudget: 25 as const,
    });
    const engineEndings = (["find_funny", "keep_it_light", "out_of_comfort_zone"] as const).map((g) => deterministicEngine.decide({ a: setup(WREN, g), b: setup(TEO, g) }, 7).ending);
    expect(engineEndings.some((e) => e !== "disaster")).toBe(true);
    const result = chemistryTest(WREN, TEO);
    expect(result.ending).toBe("disaster");
    expect(result.score).toBeLessThanOrEqual(SCORE_BANDS.disaster[1]);
    expect(result.reasons[0]).toContain("Wren");
    expect(result.reasons[0]).toContain("dealbreaker");
    expect(result.reasons[0]).toContain("witty");
  });

  it("scores more for what the engine rewards: a met want, shared traits, and less for a guarded pair", () => {
    const plainB: OcSheet = { name: "Bo", traits: ["tall", "neat", "quiet"], want: "Tea", dealbreaker: "Rudeness" };
    const plainA: OcSheet = { name: "Al", traits: ["short", "tidy", "calm"], want: "Cake", dealbreaker: "Lateness" };
    const base = chemistryTest(plainA, plainB).score;
    expect(chemistryTest({ ...plainA, want: "Someone quiet" }, plainB).score).toBeGreaterThan(base);
    expect(chemistryTest({ ...plainA, traits: ["tall", "neat", "calm"] }, plainB).score).toBeGreaterThan(base);
    expect(chemistryTest({ ...plainA, traits: ["guarded", "wary", "calm"] }, { ...plainB, traits: ["guarded", "shy", "quiet"] }).score).toBeLessThan(base);
  });

  it("gives three distinct one-line reasons that name the two characters' own words", () => {
    const { reasons } = chemistryTest(JUNIPER, DEX);
    expect(new Set(reasons).size).toBe(3);
    for (const r of reasons) {
      expect(r).not.toMatch(/\n/);
      expect(r.length).toBeLessThanOrEqual(120);
      expect(r).toMatch(/[.!]$/);
    }
    // Dex wants someone curious, and Juniper is.
    expect(reasons.join(" ")).toContain("curious");
  });

  it("renders the result with every model variable unset, no model and no network call", async () => {
    const fetchSpy = unsetEveryModel();
    const html = await renderResult(chemistryQuery(JUNIPER, DEX));
    expect(reasonsIn(html)).toHaveLength(3);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("3. the result: a shareable, server-rendered address", () => {
  it("submitting the form's fields lands on a page with both names, the score, the ending and 3 reasons", async () => {
    const query = formQuery(JUNIPER, DEX);
    const html = await renderResult(query);
    const { score, ending, reasons } = chemistryTest(JUNIPER, DEX);
    expect(html).toMatch(/<h1[^>]*>[^<]*Juniper[^<]*Dex[^<]*<\/h1>/);
    expect(html).toContain(`data-score="${score}"`);
    expect(html).toContain(`${score}`);
    expect(html).toContain(`data-ending="${ending}"`);
    expect(html).toContain(ENDING_LABELS[ending]);
    expect(reasonsIn(html)).toEqual(reasons);
  });

  it("renders the same page twice for the same address", async () => {
    const query = chemistryQuery(JUNIPER, DEX);
    expect(await renderResult(query)).toBe(await renderResult(query));
  });

  it("round-trips: the result's own address reads back as the same two characters, with stray spaces trimmed", () => {
    const href = chemistryResultHref(JUNIPER, DEX);
    expect(href.startsWith(`${CHEMISTRY_RESULT_PATH}?`)).toBe(true);
    expect(readChemistry(searchRecord(href.split("?")[1]))).toEqual({ ok: true, a: JUNIPER, b: DEX });
    const padded = formQuery({ ...JUNIPER, name: "  Juniper " }, DEX);
    expect(readChemistry(searchRecord(padded))).toMatchObject({ ok: true, a: { name: "Juniper" } });
  });

  it("has an og:title (and twitter title) with both names, a canonical address, a share card, and stays out of search", async () => {
    const meta = await resultMetadata(sp(formQuery({ ...JUNIPER, name: " Juniper" }, DEX)));
    const og = String(meta.openGraph?.title ?? "");
    expect(og).toContain("Juniper");
    expect(og).toContain("Dex");
    expect(String(meta.twitter?.title ?? "")).toContain("Dex");
    expect(String(meta.title)).toContain("Chemistry Test");
    expect(meta.alternates?.canonical).toBe(chemistryResultHref(JUNIPER, DEX));
    expect(meta.robots).toMatchObject({ index: false, follow: true });
    const images = JSON.stringify(meta.openGraph?.images ?? "");
    expect(images).toContain("/api/og/chemistry?");
  });

  it("offers a copyable link to itself and the form again, filled in with these two", async () => {
    const html = await renderResult(chemistryQuery(JUNIPER, DEX));
    expect(html).toContain(`value="${chemistryResultHref(JUNIPER, DEX)}"`);
    expect(attr(inputNamed(html, "a_name"), "value")).toBe("Juniper");
    expect(attr(inputNamed(html, "b_trait2"), "value")).toBe("funny");
    expect(attr(inputNamed(html, "b_dealbreaker"), "value")).toBe("Cynics");
  });

  it("sends an empty address back to the tool", async () => {
    await expect(ResultPage(sp(""))).rejects.toThrow(/NEXT_REDIRECT/);
  });

  it("says which field is missing or too long when an address is incomplete, with no score", async () => {
    const missing = await renderResult(formQuery(JUNIPER, DEX).replace(/&b_want=[^&]*/, ""));
    expect(missing).toMatch(/Dex.s want/);
    expect(missing).toContain("Required.");
    expect(missing).not.toContain("data-score");
    const long = await renderResult(formQuery({ ...JUNIPER, want: "x".repeat(181) }, DEX));
    expect(long).toContain("At most 180 characters.");
    const wordy = await renderResult(formQuery({ ...JUNIPER, name: "A B C D E F" }, DEX));
    expect(wordy).toContain("At most 5 words.");
  });

  it("has a share card for a pair (and for the tool) that renders to PNG", async () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const query of [chemistryQuery(JUNIPER, DEX), "", formQuery({ name: "Taylor Swift" }, DEX)]) {
      const res = await chemistryCard(new NextRequest(`http://localhost:3000/api/og/chemistry?${query}`));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await res.arrayBuffer()).subarray(0, 8)).toEqual(PNG);
    }
  });
});

describe("4. 'Watch the real date', and what the test refuses", () => {
  it("links 'Watch the real date' to /create with both characters' fields", async () => {
    const html = await renderResult(chemistryQuery(JUNIPER, DEX));
    const link = html.match(/<a[^>]*href="(\/create\?[^"]+)"[^>]*>Watch the real date<\/a>/);
    expect(link, "a 'Watch the real date' link to /create").toBeTruthy();
    expect(link![1]).toBe(createPairHref(JUNIPER, DEX));
    expect(readChemistry(searchRecord(link![1].split("?")[1]))).toEqual({ ok: true, a: JUNIPER, b: DEX });
  });

  it("opens /create with the first character's fields in the builder and the second's alongside, one click from its own", async () => {
    const html = await renderCreate(createPairHref(JUNIPER, DEX).split("?")[1]);
    expect(attr(inputNamed(html, "name"), "value")).toBe("Juniper");
    expect(attr(inputNamed(html, "trait1"), "value")).toBe("curious");
    expect(attr(inputNamed(html, "trait2"), "value")).toBe("warm");
    expect(attr(inputNamed(html, "trait3"), "value")).toBe("dry-witted");
    expect(attr(inputNamed(html, "want"), "value")).toBe(JUNIPER.want);
    expect(attr(inputNamed(html, "dealbreaker"), "value")).toBe(JUNIPER.dealbreaker);
    // Dex's fields are on the page, and a link opens the builder with them in.
    for (const value of [DEX.name, ...DEX.traits, DEX.want, DEX.dealbreaker]) expect(html).toContain(value);
    expect(hrefsTo(html, "/create?")).toContain(createPairHref(DEX, JUNIPER));
    const dexFirst = await renderCreate(createPairHref(DEX, JUNIPER).split("?")[1]);
    expect(attr(inputNamed(dexFirst, "name"), "value")).toBe("Dex");
    expect(attr(inputNamed(dexFirst, "dealbreaker"), "value")).toBe("Cynics");
  });

  it("leaves /create as it was without a pair, and ignores a pair the filter refuses", async () => {
    const plain = await renderCreate("");
    expect(attr(inputNamed(plain, "name"), "value")).toBe("");
    expect(plain).not.toContain("chemistry test");
    const refused = await renderCreate(formQuery({ name: "Taylor Swift" }, DEX));
    expect(attr(inputNamed(refused, "name"), "value")).toBe("");
    expect(refused.toLowerCase()).not.toContain("swift");
  });

  /** What /create's own save says for the same words (POST /api/characters), so the messages can't drift apart. */
  async function createSays(overrides: Record<string, unknown>): Promise<string> {
    const res = await api.createCharacter(validCharacter(overrides), newUserCookie());
    expect(res.status).toBe(422);
    return (await res.json()).message;
  }

  it.each([
    ["under 18, stated", "a_trait1", "16 years old", { traits: ["16 years old", "kind", "brave"] }, "minor"],
    ["under 18, a school", "b_want", "A high schooler", { want: "A high schooler" }, "minor"],
    ["a real person", "b_name", "Taylor Swift", { name: "Taylor Swift" }, "real_person"],
    ["a real person, squashed", "a_dealbreaker", "Fans of elonmusk", { dealbreaker: "Fans of elonmusk" }, "real_person"],
    ["sexual content", "b_dealbreaker", "Anything kinky", { dealbreaker: "Anything kinky" }, "sexual"],
    ["sexual content, leetspeak", "a_want", "A p0rn star", { want: "A p0rn star" }, "sexual"],
  ] as const)("refuses %s with /create's own message, no score and no link to /create", async (_label, param, value, createFields, reason) => {
    const query = new URLSearchParams(formQuery(JUNIPER, DEX));
    query.set(param, value);
    const html = await renderResult(query.toString());
    const message = await createSays(createFields);
    expect(message).toBe(CHARACTER_REJECTION_MESSAGES[reason]);
    expect(html).toContain(message);
    expect(html).not.toContain("data-score");
    expect(html).not.toContain("Watch the real date");
    expect(hrefsTo(html, "/create?")).toEqual([]);
    // Nothing refused is echoed back, in the page or its tags, and the page stays out of search.
    expect(html.toLowerCase()).not.toContain(value.toLowerCase());
    const meta = await resultMetadata(sp(query.toString()));
    expect(meta.robots).toMatchObject({ index: false });
    expect(JSON.stringify(meta).toLowerCase()).not.toContain(value.toLowerCase());
    // Everything that passed stays in the form, so only the refused field needs retyping.
    expect(attr(inputNamed(html, param), "value") ?? "").toBe("");
    const other = param.startsWith("a_") ? "b_name" : "a_name";
    expect(attr(inputNamed(html, other), "value")).toBeTruthy();
  });

  it("refuses at the source: readChemistry names the side, the field and the reason", () => {
    const read = readChemistry(searchRecord(formQuery(JUNIPER, { ...DEX, traits: ["kind", "kinky", "loud"] })));
    expect(read).toMatchObject({ ok: false, error: { kind: "rejected", side: "b", field: "trait2", reason: "sexual", message: CHARACTER_REJECTION_MESSAGES.sexual } });
  });
});

describe("5. findable and measured: the sitemap, the links to both tools, the beacon", () => {
  it("lists the tool in the sitemap (static part and the full sitemap.xml)", async () => {
    const base = "https://botchelor.com";
    expect(staticSitemap(base).map((e) => e.url)).toContain(`${base}${TOOL}`);
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain(`${base}${TOOL}`);
    expect(urls).toContain(`${base}/tools/ship-name-generator`);
  });

  /** A page as the site serves it: inside the root layout, with its header and footer. */
  async function inLayout(page: ReactNode): Promise<string> {
    return text(renderToStaticMarkup(await RootLayout({ children: page })));
  }

  it("links both tools from the home page itself", async () => {
    const home = text(renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) })));
    expect(hrefsTo(home, "/tools/")).toEqual(expect.arrayContaining([TOOL, "/tools/ship-name-generator"]));
  });

  it("links both tools from the footer of /create (and of the home page)", async () => {
    for (const page of [await CreatePage(sp("")), await Home({ searchParams: Promise.resolve({}) })]) {
      const html = await inLayout(page);
      const footer = html.slice(html.indexOf('<footer class="site-footer"'));
      expect(footer).toContain(`href="${TOOL}"`);
      expect(footer).toContain('href="/tools/ship-name-generator"');
    }
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
    return { sent };
  }

  it("loading the tool sends one `visit` to RepoHQ's beacon with path /tools/oc-chemistry-test", () => {
    const { sent } = browserAt(`https://botchelor.com${TOOL}`, "https://www.google.com/");
    sendFunnel("visit");
    sendFunnel("visit"); // once per browser session
    expect(sent()).toEqual([{ url: SIGNAL_URL, body: { slug: "botchelor", kind: "visit", path: TOOL, referrer: "https://www.google.com/" } }]);
  });

  it("a shared result counts as its page, and the characters someone typed never go to the beacon", () => {
    const { sent } = browserAt(`https://botchelor.com${chemistryResultHref(JUNIPER, DEX)}`);
    sendFunnel("visit");
    expect(sent()[0].body.path).toBe(CHEMISTRY_RESULT_PATH);
    expect(JSON.stringify(sent())).not.toContain("Juniper");
    // A search visitor who meets the 18+ gate first still counts for the page, without its query.
    expect(beaconPath("/gate", `?from=${encodeURIComponent(chemistryResultHref(JUNIPER, DEX))}`)).toBe(CHEMISTRY_RESULT_PATH);
    expect(beaconPath("/gate", `?from=${encodeURIComponent(TOOL)}`)).toBe(TOOL);
  });
});
