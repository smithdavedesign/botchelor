import { NextRequest } from "next/server";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// /create, the home page and the root layout read the viewer from next/headers (an anonymous visitor here), and the
// wizard asks for the router.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, getAll: () => [] }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
}));

import { GET as chemistryCard } from "@/app/api/chemistry-card/route";
import CreatePage from "@/app/create/page";
import { beaconPath, configureFunnel, sendFunnel } from "@/app/funnel";
import RootLayout from "@/app/layout";
import Home from "@/app/page";
import sitemap from "@/app/sitemap";
import ToolPage, { metadata as toolMetadata } from "@/app/tools/oc-chemistry-test/page";
import ResultPage, { generateMetadata as resultMetadata } from "@/app/tools/oc-chemistry-test/result/page";
import {
  CHEMISTRY_RESULT_PATH,
  CHEMISTRY_TEST_PATH,
  chemistryTest,
  createHref,
  prefillFromQuery,
  readChemistryTest,
  resultHref,
  SAMPLE_PAIR,
  SCORE_BANDS,
  SHEET_FIELDS,
  SHEET_LIMITS,
  type TestSheet,
} from "@/lib/chemistry-test";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setModelForTests } from "@/lib/model";
import { ENDING_LABELS, ENDINGS } from "@/lib/rules";
import { CHARACTER_REJECTION_MESSAGES } from "@/lib/safety";
import { staticSitemap } from "@/lib/seo";
import { middleware } from "@/middleware";
import { api, newUserCookie, startTestDb, validCharacter } from "./helpers";

/** React escapes quotes and apostrophes; tests compare against the plain text. */
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const renderTool = () => text(renderToStaticMarkup(createElement(ToolPage)));
type Query = Record<string, string | string[] | undefined>;
const queryOf = (href: string): Query => Object.fromEntries(new URL(href, "http://localhost:3000").searchParams);
const props = (query: Query) => ({ searchParams: Promise.resolve(query) });
const renderResult = async (query: Query) => text(renderToStaticMarkup(await ResultPage(props(query))));
const renderCreate = async (query: Query) => text(renderToStaticMarkup(await CreatePage(props(query))));
/** One input of a rendered page, by its name. */
const input = (html: string, name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
const valueOf = (tag: string) => tag.match(/value="([^"]*)"/)?.[1];
const reasonsOf = (html: string) => [...html.matchAll(/<li[^>]*data-reason[^>]*>(.*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
/** The href of the link whose text is `label`. */
const hrefOf = (html: string, label: string) =>
  [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)].find((m) => m[2].replace(/<[^>]+>/g, "") === label)?.[1];

const sheet = (name: string, traits: [string, string, string], want: string, dealbreaker: string): TestSheet => ({ name, traits, want, dealbreaker });
const [ODESSA, FITZ] = SAMPLE_PAIR;
/** The sample pair's form fields, as the tool's form submits them. */
const sampleQuery = () => queryOf(resultHref(ODESSA, FITZ));

// Every variable that points the app at a model. The test must never need one.
const LLM_ENV = /^(LLM_|FRONTIER_|GOOGLE_API_KEY$|OPENAI_|ANTHROPIC_|AI_GATEWAY_|VERCEL_OIDC)/;
function unsetEveryModel() {
  for (const key of Object.keys(process.env)) if (LLM_ENV.test(key)) vi.stubEnv(key, undefined);
  for (const key of ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "GOOGLE_API_KEY", "FRONTIER_LLM_API_KEY", "FRONTIER_DEFAULT"]) vi.stubEnv(key, undefined);
  // A model (or any network call) would fail the test loudly.
  const model = vi.fn(async () => {
    throw new Error("the chemistry test called a model");
  });
  setModelForTests({ complete: model });
  const fetchSpy = vi.fn(async () => {
    throw new Error("the chemistry test made a network call");
  });
  vi.stubGlobal("fetch", fetchSpy);
  return { model, fetchSpy };
}

// /create, the home page and sitemap.xml read the database: a throwaway PGlite, as in every route test.
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
  it("is a GET form to the result page with, for each of two characters, a name, three traits, a want and a dealbreaker", () => {
    const html = renderTool();
    expect(html).toMatch(/<form[^>]*action="\/tools\/oc-chemistry-test\/result"[^>]*method="get"|<form[^>]*method="get"[^>]*action="\/tools\/oc-chemistry-test\/result"/);
    const names = [...html.matchAll(/<input[^>]*name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(["a", "b"].flatMap((side) => SHEET_FIELDS.map((f) => `${side}_${f}`)));
    for (const name of names) expect(input(html, name)).toContain("required");
    // Each character has its own labelled group, and every input a label.
    expect(html.match(/<fieldset/g)).toHaveLength(2);
    expect(html.match(/<label/g)!.length).toBeGreaterThanOrEqual(names.length);
  });

  it("uses /create's own limits on every field (read off the rendered builder, so they can't drift apart)", async () => {
    const create = await renderCreate({});
    const tool = renderTool();
    const maxOf = (tag: string) => Number(tag.match(/maxLength="(\d+)"/)?.[1]);
    const builder = { name: "name", trait1: "trait1", trait2: "trait2", trait3: "trait3", want: "want", dealbreaker: "dealbreaker" } as const;
    for (const side of ["a", "b"]) {
      for (const field of SHEET_FIELDS) {
        expect(maxOf(input(tool, `${side}_${field}`)), `${side}_${field}`).toBe(maxOf(input(create, builder[field])));
      }
    }
    expect(SHEET_LIMITS).toMatchObject({ name: 40, trait: 30, want: 140, dealbreaker: 140, nameWords: 5 });
  });

  it("has a <title> with 'Chemistry Test', a description, a canonical link to itself and a share card, and is indexable", () => {
    expect(String(toolMetadata.title)).toContain("Chemistry Test");
    expect(toolMetadata.description).toBeTruthy();
    expect(toolMetadata.alternates?.canonical).toBe(CHEMISTRY_TEST_PATH);
    expect(String(toolMetadata.openGraph?.title)).toContain("Chemistry Test");
    expect(JSON.stringify(toolMetadata.openGraph?.images)).toContain("/api/chemistry-card");
    expect(toolMetadata.robots).toBeUndefined(); // indexable, like the site
  });

  it("has an h1 with 'Chemistry Test' and links a worked example, so a visitor (or crawler) sees a result first", () => {
    const html = renderTool();
    expect(html).toMatch(/<h1[^>]*>[^<]*Chemistry Test[^<]*<\/h1>/);
    expect(html).toContain(`href="${resultHref(ODESSA, FITZ)}"`);
  });

  it("answers crawlers directly (a 200) and sends a person through the 18+ gate back to the tool", () => {
    const googlebot = middleware(new NextRequest(`http://localhost:3000${CHEMISTRY_TEST_PATH}`, { headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" } }));
    expect(googlebot.headers.get("x-middleware-next")).toBe("1");
    const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
    const adult = middleware(new NextRequest(`http://localhost:3000${CHEMISTRY_TEST_PATH}`, { headers: { "user-agent": chrome, cookie: "bz_adult=1" } }));
    expect(adult.headers.get("x-middleware-next")).toBe("1");
    // A shared result keeps its whole address through the gate.
    const shared = `http://localhost:3000${resultHref(ODESSA, FITZ)}`;
    const fresh = middleware(new NextRequest(shared, { headers: { "user-agent": chrome } }));
    expect(new URL(fresh.headers.get("location")!).searchParams.get("from")).toBe(resultHref(ODESSA, FITZ));
  });
});

describe("2. the score: the show's own engine, deterministic, and no model", () => {
  it("gives the same two characters the same 0-100 score and the same ending, every time", () => {
    const first = chemistryTest(ODESSA, FITZ);
    const again = chemistryTest(ODESSA, FITZ);
    expect(again).toEqual(first);
    expect(Number.isInteger(first.score)).toBe(true);
    expect(first.score).toBeGreaterThanOrEqual(0);
    expect(first.score).toBeLessThanOrEqual(100);
    expect(ENDINGS).toContain(first.ending);
  });

  it("reads the sheets, not how they were typed: case and stray spaces don't change the answer", () => {
    const shouty = sheet(`  ${ODESSA.name.toUpperCase()} `, ODESSA.traits.map((x) => ` ${x.toUpperCase()}`) as [string, string, string], ODESSA.want.toLowerCase(), ` ${ODESSA.dealbreaker}`);
    const read = readChemistryTest(queryOf(resultHref(shouty, FITZ)));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const { score, ending } = chemistryTest(read.a, read.b);
    expect({ score, ending }).toEqual({ score: chemistryTest(ODESSA, FITZ).score, ending: chemistryTest(ODESSA, FITZ).ending });
  });

  it("always gives a score inside its ending's band, and all three endings happen across the house cast", () => {
    const cast = HOUSE_CHARACTERS.map((c) => sheet(c.name, [...c.traits], c.want, c.dealbreaker));
    const seen = new Set<string>();
    for (const a of cast) {
      for (const b of cast) {
        if (a === b) continue;
        const r = chemistryTest(a, b);
        const [lo, hi] = SCORE_BANDS[r.ending];
        expect(r.score, `${a.name} × ${b.name}`).toBeGreaterThanOrEqual(lo);
        expect(r.score, `${a.name} × ${b.name}`).toBeLessThanOrEqual(hi);
        seen.add(r.ending);
      }
    }
    expect([...seen].sort()).toEqual([...ENDINGS].sort());
    // The bands cover 0-100 with no gap and no overlap, worst to best.
    expect([SCORE_BANDS.disaster, SCORE_BANDS.friends, SCORE_BANDS.second_date]).toEqual([[0, 39], [40, 69], [70, 100]]);
  });

  it("a character whose dealbreaker matches the other's trait always gets a disaster, whichever side it is", () => {
    // Otherwise the sample pair is a second date: both wants met.
    expect(chemistryTest(ODESSA, FITZ).ending).toBe("second_date");
    const odessa = { ...ODESSA, dealbreaker: "Anyone flaky" };
    const fitz = { ...FITZ, traits: ["flaky", "witty", "meteor chaser"] as const };
    for (const [a, b] of [[odessa, fitz], [fitz, odessa]]) {
      const r = chemistryTest(a, b);
      expect(r.ending, `${a.name} × ${b.name}`).toBe("disaster");
      expect(r.score).toBeLessThanOrEqual(SCORE_BANDS.disaster[1]);
      expect(r.tripped).toEqual([{ side: a === odessa ? "a" : "b", cue: "flaky" }]);
    }
    // A plural in the dealbreaker meets the singular trait, as on a real date.
    expect(chemistryTest({ ...ODESSA, dealbreaker: "Smokers" }, { ...FITZ, traits: ["smoker", "warm", "witty"] }).ending).toBe("disaster");
  });

  it("goes off on the other's trait named outright, even a word the engine's cue matching skips (a stopword, an accent)", () => {
    // "loud" is one of the engine's stopwords (lib/engine.ts cues), so its matching never sees it. Fitz still meets
    // both wants, so on the numbers alone this pair is no disaster.
    const loud = { ...FITZ, traits: ["loud", "witty", "meteor chaser"] as const };
    expect(chemistryTest(ODESSA, loud).ending).not.toBe("disaster");
    for (const dealbreaker of ["Loud", "Loud people", "Anyone LOUD."]) {
      const odessa = { ...ODESSA, dealbreaker };
      for (const [a, b] of [[odessa, loud], [loud, odessa]]) {
        const r = chemistryTest(a, b);
        expect(r.ending, `${dealbreaker}: ${a.name} × ${b.name}`).toBe("disaster");
        expect(r.score).toBeLessThanOrEqual(SCORE_BANDS.disaster[1]);
        expect(r.tripped).toEqual([{ side: a === odessa ? "a" : "b", cue: "loud" }]);
        expect(r.reasons[0]).toBe("Odessa's dealbreaker goes off: Fitz is “loud”, and that ends it.");
      }
    }
    // A plural meets the singular, and a trait of two words is matched whole.
    expect(chemistryTest({ ...ODESSA, dealbreaker: "Night owls" }, { ...FITZ, traits: ["night owl", "witty", "meteor chaser"] }).ending).toBe("disaster");
    // An accented trait isn't split at its accent, and meets the word typed with or without it.
    const naive = { ...FITZ, traits: ["naïve", "witty", "meteor chaser"] as const };
    expect(chemistryTest(ODESSA, naive).ending).not.toBe("disaster");
    for (const dealbreaker of ["Naïve people", "Anyone naive", "NAÏVE"]) {
      const r = chemistryTest({ ...ODESSA, dealbreaker }, naive);
      expect(r.ending, dealbreaker).toBe("disaster");
      expect(r.reasons[0]).toBe("Odessa's dealbreaker goes off: Fitz is “naïve”, and that ends it.");
    }
    // Whole words only: "cloudy" doesn't name "loud".
    expect(chemistryTest({ ...ODESSA, dealbreaker: "Cloudy days" }, loud).tripped).toEqual([]);
  });

  it("is a disaster even when everything else lines up: shared traits and both wants met", () => {
    const a = sheet("Ada", ["witty", "warm", "curious"], "Someone witty", "Anyone smug");
    const b = sheet("Bo", ["witty", "warm", "smug"], "Someone curious", "Rudeness");
    const r = chemistryTest(a, b);
    expect(r.tripped.map((x) => x.side)).toEqual(["a"]);
    expect(r.ending).toBe("disaster");
  });

  it("any tripped dealbreaker, over every pairing of the house cast with a trait swapped in, is a disaster", () => {
    let trips = 0;
    for (const x of HOUSE_CHARACTERS) {
      // A long word from x's dealbreaker, made a trait of the other side.
      const word = x.dealbreaker.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 5).sort((p, q) => q.length - p.length)[0];
      if (!word) continue;
      for (const y of HOUSE_CHARACTERS) {
        if (x === y) continue;
        const a = sheet(x.name, [...x.traits], x.want, x.dealbreaker);
        const b = sheet(y.name, [word.slice(0, SHEET_LIMITS.trait), y.traits[1], y.traits[2]], y.want, y.dealbreaker);
        const r = chemistryTest(a, b);
        if (r.tripped.some((s) => s.side === "a")) trips++;
        if (r.tripped.length) expect(r.ending, `${x.name} × ${y.name} (${word})`).toBe("disaster");
      }
    }
    expect(trips).toBeGreaterThan(50);
  });

  it("gives exactly three one-line reasons, and a tripped dealbreaker is the first", () => {
    for (const [a, b] of [[ODESSA, FITZ], [FITZ, ODESSA]] as const) {
      const r = chemistryTest(a, b);
      expect(r.reasons).toHaveLength(3);
      expect(new Set(r.reasons).size).toBe(3);
      for (const line of r.reasons) {
        expect(line.trim().length).toBeGreaterThan(10);
        expect(line).not.toMatch(/\n/);
        expect(line.length).toBeLessThanOrEqual(140);
      }
    }
    const r = chemistryTest({ ...ODESSA, dealbreaker: "Anyone flaky" }, { ...FITZ, traits: ["flaky", "witty", "meteor chaser"] });
    expect(r.reasons[0]).toBe("Odessa's dealbreaker goes off: Fitz is “flaky”, and that ends it.");
    // In a want, it says so.
    const inWant = chemistryTest({ ...ODESSA, dealbreaker: "People who know everything" }, FITZ);
    expect(inWant.ending).toBe("disaster");
    expect(inWant.reasons[0]).toBe("Odessa's dealbreaker goes off at what Fitz wants (“everything”), and that ends it.");
  });

  it("makes no model call and no network call", async () => {
    const { model, fetchSpy } = unsetEveryModel();
    chemistryTest(ODESSA, FITZ);
    await renderResult(sampleQuery());
    await resultMetadata(props(sampleQuery()));
    expect(model).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("3. the result: a shareable address that server-renders the answer", () => {
  it("submitting the tool's form lands on a result address that holds both sheets", () => {
    const href = resultHref(ODESSA, FITZ);
    expect(href.startsWith(`${CHEMISTRY_RESULT_PATH}?`)).toBe(true);
    const read = readChemistryTest(queryOf(href));
    expect(read).toEqual({ ok: true, a: ODESSA, b: FITZ });
  });

  it("server-renders both names, the score, the predicted ending and the three reasons", async () => {
    const r = chemistryTest(ODESSA, FITZ);
    const html = await renderResult(sampleQuery());
    expect(html).toMatch(new RegExp(`<h1[^>]*>${ODESSA.name} × ${FITZ.name}</h1>`));
    expect(html).toContain(`data-score="${r.score}"`);
    expect(html).toContain(`${r.score}/100`);
    expect(html).toContain(`data-ending="${r.ending}"`);
    expect(html).toContain(ENDING_LABELS[r.ending]);
    expect(reasonsOf(html)).toEqual(r.reasons);
  });

  it("renders the same page on reload", async () => {
    expect(await renderResult(sampleQuery())).toBe(await renderResult(sampleQuery()));
  });

  it("offers a copyable link to itself and the form again, filled in, to change something and retest", async () => {
    const html = await renderResult(sampleQuery());
    expect(html).toContain(`value="${resultHref(ODESSA, FITZ)}"`);
    expect(valueOf(input(html, "a_name"))).toBe(ODESSA.name);
    expect(valueOf(input(html, "b_trait3"))).toBe(FITZ.traits[2]);
    expect(valueOf(input(html, "b_dealbreaker"))).toBe(FITZ.dealbreaker);
  });

  it("has an og:title (and twitter title) with both names, a share card, and stays out of search results", async () => {
    const meta = await resultMetadata(props(sampleQuery()));
    const r = chemistryTest(ODESSA, FITZ);
    for (const title of [meta.openGraph?.title, meta.twitter?.title, meta.title]) {
      expect(String(title)).toContain("Odessa Crane");
      expect(String(title)).toContain("Fitz Harlow");
    }
    expect(String(meta.openGraph?.title)).toContain(`${r.score}/100`);
    expect(String(meta.description)).toContain(r.reasons[0]);
    // Typed text never goes in an index: the tool page is the one to rank.
    expect(meta.robots).toMatchObject({ index: false, follow: true });
    const image = JSON.stringify(meta.openGraph?.images);
    expect(image).toContain("/api/chemistry-card?");
  });

  it("has a share card for a result, and a plain one for the tool or anything refused, all PNGs", async () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const card = (q: string) => chemistryCard(new NextRequest(`http://localhost:3000/api/chemistry-card${q}`));
    const refused = resultHref(sheet("Taylor Swift", ["kind", "loud", "witty"], "Someone kind", "Liars"), FITZ).split("?")[1];
    for (const res of [await card(`?${resultHref(ODESSA, FITZ).split("?")[1]}`), await card(""), await card(`?${refused}`)]) {
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await res.arrayBuffer()).subarray(0, 8)).toEqual(PNG);
    }
  });
});

describe("4. 'Watch the real date' goes to /create with both sheets in, and refusals match /create's", () => {
  it("links 'Watch the real date' to /create with both characters' fields", async () => {
    const html = await renderResult(sampleQuery());
    const href = hrefOf(html, "Watch the real date");
    expect(href).toBe(createHref(ODESSA, FITZ));
    const q = queryOf(href!);
    expect(q).toMatchObject({
      name: ODESSA.name, trait1: ODESSA.traits[0], trait2: ODESSA.traits[1], trait3: ODESSA.traits[2], want: ODESSA.want, dealbreaker: ODESSA.dealbreaker,
      with_name: FITZ.name, with_trait1: FITZ.traits[0], with_trait2: FITZ.traits[1], with_trait3: FITZ.traits[2], with_want: FITZ.want, with_dealbreaker: FITZ.dealbreaker,
    });
  });

  it("/create opens with the first character's fields filled in, and a link that opens it with the second's", async () => {
    const create = await renderCreate(queryOf(createHref(ODESSA, FITZ)));
    expect(valueOf(input(create, "name"))).toBe(ODESSA.name);
    expect([1, 2, 3].map((i) => valueOf(input(create, `trait${i}`)))).toEqual([...ODESSA.traits]);
    expect(valueOf(input(create, "want"))).toBe(ODESSA.want);
    expect(valueOf(input(create, "dealbreaker"))).toBe(ODESSA.dealbreaker);
    // Fitz is next, filled in too.
    const next = hrefOf(create, `Build ${FITZ.name.split(" ")[0]} next`);
    expect(next).toBe(createHref(FITZ));
    const second = await renderCreate(queryOf(next!));
    expect(valueOf(input(second, "name"))).toBe(FITZ.name);
    expect([1, 2, 3].map((i) => valueOf(input(second, `trait${i}`)))).toEqual([...FITZ.traits]);
    expect(valueOf(input(second, "want"))).toBe(FITZ.want);
    expect(valueOf(input(second, "dealbreaker"))).toBe(FITZ.dealbreaker);
    expect(second).not.toContain(" next</a>");
  });

  it("/create's prefill keeps to the builder's limits and drops what the content rules refuse", () => {
    expect(prefillFromQuery({})).toBeNull();
    expect(prefillFromQuery({ name: "Juniper" })).toEqual({ name: "Juniper" });
    const long = prefillFromQuery({ name: "x".repeat(80), trait1: "y".repeat(60), want: "z".repeat(300) });
    expect(long).toMatchObject({ name: "x".repeat(SHEET_LIMITS.name), want: "z".repeat(SHEET_LIMITS.want) });
    expect(long?.traits?.[0]).toBe("y".repeat(SHEET_LIMITS.trait));
    const unsafe = prefillFromQuery({ name: "Elon Musk", trait1: "horny", trait2: "kind", want: "A schoolgirl", dealbreaker: "Liars" });
    expect(unsafe).toEqual({ traits: ["", "kind", ""], dealbreaker: "Liars" });
  });

  it.each([
    ["under 18, in a want", "a", "want", "Someone who is 16 years old", "minor"],
    ["under 18, as a trait", "b", "trait2", "teen", "minor"],
    ["under 18, in so many words", "a", "dealbreaker", "Anyone under 18", "minor"],
    ["a real person, as a name", "a", "name", "Taylor Swift", "real_person"],
    ["a real person, in a want", "b", "want", "To meet Zendaya", "real_person"],
    ["sexual content, as a trait", "a", "trait1", "horny", "sexual"],
    ["sexual content, leetspeak", "b", "dealbreaker", "p0rn", "sexual"],
  ] as const)("refuses %s with /create's own message, no score and no link to /create", async (_label, side, field, value, reason) => {
    const q = { ...sampleQuery(), [`${side}_${field}`]: value };
    const html = await renderResult(q);
    expect(html).toContain(CHARACTER_REJECTION_MESSAGES[reason]);
    expect(html).toContain('role="alert"');
    expect(html).not.toMatch(/data-score=/);
    expect(html).not.toContain("Watch the real date");
    expect(html).not.toContain('href="/create?');
    // The refused words are never echoed: not in the page, the form, the title or the share text.
    const meta = await resultMetadata(props(q));
    expect(meta.robots).toMatchObject({ index: false });
    for (const out of [html, JSON.stringify(meta)]) expect(out.toLowerCase()).not.toContain(value.toLowerCase());
    expect(readChemistryTest(q)).toMatchObject({ ok: false, error: reason, side, field });
  });

  it("uses exactly the message POST /api/characters (what /create calls) gives the same words", async () => {
    const cases = [
      ["minor", { want: "Someone who is 16 years old" }],
      ["real_person", { name: "Taylor Swift" }],
      ["sexual", { traits: ["horny", "kind", "warm"] }],
    ] as const;
    for (const [reason, overrides] of cases) {
      const res = await api.createCharacter(validCharacter(overrides), newUserCookie());
      expect(res.status).toBe(422);
      const { message } = await res.json();
      expect(message).toBe(CHARACTER_REJECTION_MESSAGES[reason]);
    }
  });

  it("an empty, missing or too-long field gets /create's limit message and the form back", async () => {
    const cases: [Query, string][] = [
      [{ ...sampleQuery(), b_want: "" }, "Required."],
      [{ ...sampleQuery(), a_trait2: undefined }, "Required."],
      [{ ...sampleQuery(), a_name: "x".repeat(SHEET_LIMITS.name + 1) }, `At most ${SHEET_LIMITS.name} characters.`],
      [{ ...sampleQuery(), b_trait1: "y".repeat(SHEET_LIMITS.trait + 1) }, `At most ${SHEET_LIMITS.trait} characters.`],
      [{ ...sampleQuery(), a_dealbreaker: "z".repeat(SHEET_LIMITS.dealbreaker + 1) }, `At most ${SHEET_LIMITS.dealbreaker} characters.`],
      [{ ...sampleQuery(), b_name: "One Two Three Four Five Six" }, `At most ${SHEET_LIMITS.nameWords} words.`],
    ];
    for (const [q, message] of cases) {
      const html = await renderResult(q);
      expect(html).toContain(message);
      expect(html).not.toMatch(/data-score=/);
      expect(html).toMatch(/<form[^>]*action="\/tools\/oc-chemistry-test\/result"/);
      expect((await resultMetadata(props(q))).robots).toMatchObject({ index: false });
    }
    // Nothing typed at all: just the form.
    expect(await renderResult({})).toMatch(/<form[^>]*action="\/tools\/oc-chemistry-test\/result"/);
  });
});

describe("5. findable: the sitemap, the footer on the home page and /create, and the beacon", () => {
  it("lists the tool in the sitemap (static part and the full sitemap.xml), and never a result", async () => {
    const base = "https://botchelor.com";
    expect(staticSitemap(base).map((e) => e.url)).toContain(`${base}${CHEMISTRY_TEST_PATH}`);
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain(`${base}${CHEMISTRY_TEST_PATH}`);
    expect(urls).toContain(`${base}/tools/ship-name-generator`);
    expect(urls.join(" ")).not.toContain(CHEMISTRY_RESULT_PATH);
  });

  /** The site footer around a page, as the root layout renders it. */
  const footerAround = async (page: ReactNode) => {
    const html = renderToStaticMarkup(await RootLayout({ children: page }));
    return html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";
  };

  it("the home page's and /create's footer link to both free tools", async () => {
    const home = await footerAround(await Home(props({})));
    const create = await footerAround(await CreatePage(props({})));
    for (const footer of [home, create]) {
      expect(footer).toContain(`href="${CHEMISTRY_TEST_PATH}"`);
      expect(footer).toContain('href="/tools/ship-name-generator"');
    }
  });

  /** A browser for app/funnel.ts: production, a real visitor, at `href`. */
  function browserAt(href: string) {
    const url = new URL(href);
    const store = () => {
      const m = new Map<string, string>();
      return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    };
    const send = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", { cookie: "", referrer: "https://www.google.com/" });
    vi.stubGlobal("location", { origin: url.origin, pathname: url.pathname, search: url.search });
    vi.stubGlobal("navigator", { webdriver: false });
    vi.stubGlobal("sessionStorage", store());
    vi.stubGlobal("localStorage", store());
    vi.stubGlobal("fetch", send);
    configureFunnel({ production: true, consentDefault: true });
    return () => send.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
  }

  it("a visit counts for the tool, and a result counts as its page without anything typed in it", () => {
    let sent = browserAt(`https://botchelor.com${CHEMISTRY_TEST_PATH}`);
    sendFunnel("visit");
    expect(sent()).toEqual([{ slug: "botchelor", kind: "visit", path: CHEMISTRY_TEST_PATH, referrer: "https://www.google.com/" }]);
    sent = browserAt(`https://botchelor.com${resultHref(ODESSA, FITZ)}`);
    sendFunnel("visit");
    expect(sent()[0].path).toBe(CHEMISTRY_RESULT_PATH);
    expect(JSON.stringify(sent())).not.toMatch(/odessa|fitz/i);
    // Through the 18+ gate, too.
    expect(beaconPath("/gate", `?from=${encodeURIComponent(resultHref(ODESSA, FITZ))}`)).toBe(CHEMISTRY_RESULT_PATH);
  });
});
