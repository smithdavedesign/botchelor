import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// /create and the layout read the viewer from next/headers (an anonymous visitor here), and the wizard and the nav
// ask for the router.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, getAll: () => [] }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  usePathname: () => "/create",
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));

import { GET as chemistryCardRoute } from "@/app/api/og/chemistry/route";
import CreatePage from "@/app/create/page";
import { beaconPath } from "@/app/funnel";
import RootLayout from "@/app/layout";
import Home from "@/app/page";
import sitemap from "@/app/sitemap";
import ToolOg from "@/app/tools/oc-chemistry-test/opengraph-image";
import ToolPage, { metadata as toolMetadata } from "@/app/tools/oc-chemistry-test/page";
import ResultPage, { generateMetadata as resultMetadata } from "@/app/tools/oc-chemistry-test/result/page";
import {
  CHEMISTRY_CARD_PATH,
  CHEMISTRY_PATH,
  CHEMISTRY_RESULT_PATH,
  chemistryTest,
  createHref,
  pairQuery,
  readPair,
  resultPath,
  SHEET_LIMITS,
  type ChemistrySheet,
} from "@/lib/chemistry";
import { setModelForTests } from "@/lib/model";
import { ENDING_LABELS, ENDINGS } from "@/lib/rules";
import { staticSitemap } from "@/lib/seo";
import { middleware } from "@/middleware";
import { api, newUserCookie, startTestDb } from "./helpers";

/** React escapes quotes, apostrophes and ampersands; the tests compare against the plain text. */
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const renderTool = () => text(renderToStaticMarkup(createElement(ToolPage)));
type Form = Record<string, string>;
const searchParams = (q: Form | URLSearchParams) => ({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(q))) });
const renderResult = async (q: Form | URLSearchParams) => text(renderToStaticMarkup(await ResultPage(searchParams(q))));
const renderCreate = async (q: Form | URLSearchParams) => text(renderToStaticMarkup(await CreatePage(searchParams(q))));
/** An input's tag in rendered HTML, by its name attribute. */
const input = (html: string, name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

// Two sample OCs, invented for these tests.
type Raw = { name: string; age?: string; traits: [string, string, string]; want: string; dealbreaker: string };
const MIRA: Raw = { name: "Mira Quell", age: "29", traits: ["curious", "stubborn", "witty"], want: "someone who gets lost on purpose", dealbreaker: "people who are always on their phone" };
const OTTO: Raw = { name: "Otto Brand", age: "34", traits: ["bold", "warm", "funny"], want: "a curious mind", dealbreaker: "arrogance" };

/** The form a visitor submits (the tool's field names): a_name, a_age, a_trait1…3, a_want, a_dealbreaker, and b_…. */
function form(a: Raw, b: Raw): Form {
  const side = (p: "a" | "b", s: Raw): Form => ({
    [`${p}_name`]: s.name,
    [`${p}_age`]: s.age ?? "",
    [`${p}_trait1`]: s.traits[0],
    [`${p}_trait2`]: s.traits[1],
    [`${p}_trait3`]: s.traits[2],
    [`${p}_want`]: s.want,
    [`${p}_dealbreaker`]: s.dealbreaker,
  });
  return { ...side("a", a), ...side("b", b) };
}
const sheet = (s: Raw): ChemistrySheet => ({ name: s.name, age: s.age ? Number(s.age) : null, traits: [...s.traits], want: s.want, dealbreaker: s.dealbreaker });

const FIELDS = ["name", "age", "trait1", "trait2", "trait3", "want", "dealbreaker"] as const;

// Every variable that points the app at a model. The test must never need one.
const LLM_ENV = /^(LLM_|FRONTIER_|GOOGLE_API_KEY$|OPENAI_|ANTHROPIC_|AI_GATEWAY_|VERCEL_OIDC)/;
function unsetEveryModel() {
  for (const key of Object.keys(process.env)) if (LLM_ENV.test(key)) vi.stubEnv(key, undefined);
  for (const key of ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "GOOGLE_API_KEY", "FRONTIER_LLM_API_KEY", "FRONTIER_DEFAULT"]) vi.stubEnv(key, undefined);
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
  it("has a <title> with 'Chemistry Test', an h1, a description and a canonical link to itself, and is indexable", () => {
    expect(String(toolMetadata.title)).toContain("Chemistry Test");
    expect(renderTool()).toMatch(/<h1[^>]*>[^<]*Chemistry Test[^<]*<\/h1>/);
    expect(toolMetadata.description).toBeTruthy();
    expect(toolMetadata.alternates?.canonical).toBe(CHEMISTRY_PATH);
    expect(toolMetadata.openGraph?.title).toBeTruthy();
    expect(toolMetadata.robots).toBeUndefined();
  });

  it("is a plain GET form to the result page with two characters: name, age, three traits, a want and a dealbreaker each", () => {
    const html = renderTool();
    expect(html).toMatch(new RegExp(`<form[^>]*action="${CHEMISTRY_RESULT_PATH}"[^>]*method="get"|<form[^>]*method="get"[^>]*action="${CHEMISTRY_RESULT_PATH}"`));
    const names = [...html.matchAll(/<input[^>]*name="([^"]+)"[^>]*>/g)].map((m) => m[1]);
    expect(names).toEqual(["a", "b"].flatMap((p) => FIELDS.map((f) => `${p}_${f}`)));
    // Two labelled characters, every field labelled.
    expect(html).toMatch(/<legend[^>]*>First character/);
    expect(html).toMatch(/<legend[^>]*>Second character/);
    for (const label of ["Name", "Age", "Three traits", "What they want from a date", "Their dealbreaker"]) {
      expect(html.match(new RegExp(`>${label}`, "g"))?.length, label).toBeGreaterThanOrEqual(2);
    }
  });

  it("uses /create's limits: the same maxLength on every text field, 18 to 1000 for an age, and the same required fields", async () => {
    const tool = renderTool();
    const create = await renderCreate({});
    const pairs: [string, string][] = [["name", "name"], ["trait1", "trait1"], ["trait2", "trait2"], ["trait3", "trait3"], ["want", "want"], ["dealbreaker", "dealbreaker"]];
    for (const p of ["a", "b"]) {
      for (const [mine, theirs] of pairs) {
        const field = input(tool, `${p}_${mine}`);
        expect(attr(field, "maxLength"), `${p}_${mine}`).toBe(attr(input(create, theirs), "maxLength"));
        expect(field, `${p}_${mine} is required, as on /create`).toContain("required");
      }
      const age = input(tool, `${p}_age`);
      expect(attr(age, "type")).toBe("number");
      expect(attr(age, "min")).toBe(attr(input(create, "age"), "min"));
      expect(attr(age, "max")).toBe(attr(input(create, "age"), "max"));
    }
    expect(SHEET_LIMITS).toMatchObject({ name: 40, trait: 30, want: 140, dealbreaker: 140, minAge: 18, maxAge: 1000 });
  });

  it("answers crawlers directly and sends a person through the 18+ gate back to the tool (a 200 either way)", () => {
    const googlebot = middleware(new NextRequest(`http://localhost:3000${CHEMISTRY_PATH}`, { headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" } }));
    expect(googlebot.headers.get("x-middleware-next")).toBe("1");
    const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
    const adult = middleware(new NextRequest(`http://localhost:3000${CHEMISTRY_PATH}`, { headers: { "user-agent": chrome, cookie: "bz_adult=1" } }));
    expect(adult.headers.get("x-middleware-next")).toBe("1");
    const fresh = middleware(new NextRequest(`http://localhost:3000${CHEMISTRY_PATH}`, { headers: { "user-agent": chrome } }));
    expect(new URL(fresh.headers.get("location")!).searchParams.get("from")).toBe(CHEMISTRY_PATH);
  });

  it("links an example result that really is one", async () => {
    const html = renderTool();
    const example = html.match(new RegExp(`href="(${CHEMISTRY_RESULT_PATH}\\?[^"]+)"`))?.[1];
    expect(example).toBeTruthy();
    const result = await renderResult(new URL(example!, "http://localhost:3000").searchParams);
    expect(result).toMatch(/data-chemistry-score="\d+"/);
  });

  it("has a share card that renders to PNG", async () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(Buffer.from(await (await ToolOg()).arrayBuffer()).subarray(0, 8)).toEqual(PNG);
  });
});

describe("2. the score: deterministic, 0 to 100, one of three endings, a dealbreaker is a disaster, no model", () => {
  it("gives the same two characters the same score and ending every time", () => {
    const first = chemistryTest(sheet(MIRA), sheet(OTTO));
    const again = chemistryTest(sheet(MIRA), sheet(OTTO));
    expect(again).toEqual(first);
    expect(Number.isInteger(first.score)).toBe(true);
    expect(first.score).toBeGreaterThanOrEqual(0);
    expect(first.score).toBeLessThanOrEqual(100);
    expect(ENDINGS).toContain(first.ending);
  });

  it("submitting the same form twice server-renders the same score and ending, with no model and no network", async () => {
    const { model, fetchSpy } = unsetEveryModel();
    const read = (html: string) => ({
      score: html.match(/data-chemistry-score="(\d+)"/)?.[1],
      ending: html.match(/data-chemistry-ending="([a-z_]+)"/)?.[1],
    });
    const first = read(await renderResult(form(MIRA, OTTO)));
    const again = read(await renderResult(form(MIRA, OTTO)));
    expect(first.score).toBeDefined();
    expect(again).toEqual(first);
    expect(ENDINGS).toContain(first.ending);
    expect(String(chemistryTest(sheet(MIRA), sheet(OTTO)).score)).toBe(first.score);
    expect(model).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("doesn't care about case, stray spaces or which character goes first", () => {
    const base = chemistryTest(sheet(MIRA), sheet(OTTO));
    const messy: Raw = { ...MIRA, name: "  MIRA   quell ", traits: ["Curious", " stubborn", "WITTY "], want: "Someone who gets lost on purpose" };
    expect({ ...chemistryTest(sheet(messy), sheet(OTTO)), reasons: [] }).toEqual({ ...base, reasons: [] });
    const swapped = chemistryTest(sheet(OTTO), sheet(MIRA));
    expect(swapped.score).toBe(base.score);
    expect(swapped.ending).toBe(base.ending);
  });

  it("a character whose dealbreaker matches the other's trait always gets a disaster, whichever side it's on", () => {
    // Otto is everything the engine likes (warm, funny, open, with Mira's want in his traits); his trait "loud" is
    // Mira's whole dealbreaker.
    const mira: Raw = { ...MIRA, dealbreaker: "loud" };
    const otto: Raw = { ...OTTO, traits: ["warm", "funny", "loud"], want: "someone curious and witty" };
    for (const [a, b] of [[mira, otto], [otto, mira]] as const) {
      const r = chemistryTest(sheet(a), sheet(b));
      expect(r.ending).toBe("disaster");
      expect(r.score).toBeLessThan(40);
    }
    // A dealbreaker that only names the trait among other words, plural or not.
    for (const dealbreaker of ["Loud people", "anyone who is too loud", "LOUD!"]) {
      expect(chemistryTest(sheet({ ...mira, dealbreaker }), sheet(otto)).ending).toBe("disaster");
    }
    // Even a trait the engine's word matching skips (two letters) trips a dealbreaker that is exactly that trait.
    expect(chemistryTest(sheet({ ...mira, dealbreaker: "OK" }), sheet({ ...otto, traits: ["warm", "funny", "OK"] })).ending).toBe("disaster");
  });

  it("holds over many generated pairs: any trait named by the other's dealbreaker is a disaster", () => {
    const words = ["curious", "stubborn", "witty", "bold", "warm", "funny", "shy", "loyal", "dramatic", "gentle", "reckless", "punctual", "guarded", "kind", "loud", "sarcastic"];
    let checked = 0;
    for (let i = 0; i < words.length; i++) {
      for (let j = 0; j < words.length; j++) {
        const traitsA: [string, string, string] = [words[i], words[(i + 3) % words.length], words[(i + 7) % words.length]];
        const traitsB: [string, string, string] = [words[j], words[(j + 5) % words.length], words[(j + 9) % words.length]];
        const a: Raw = { name: "Wren Ash", traits: traitsA, want: "a long walk somewhere new", dealbreaker: `someone ${traitsB[(i + j) % 3]}` };
        const b: Raw = { name: "Teo Marsh", traits: traitsB, want: `someone ${traitsA[j % 3]}`, dealbreaker: "pineapple on pizza" };
        expect(chemistryTest(sheet(a), sheet(b)).ending, `${a.dealbreaker} vs ${traitsB.join(", ")}`).toBe("disaster");
        checked++;
      }
    }
    expect(checked).toBe(words.length ** 2);
  });

  it("can predict each of the three endings, and the score's band always matches the ending", () => {
    const seen = new Set<string>();
    const traits = ["curious", "stubborn", "witty", "bold", "warm", "funny", "shy", "loyal", "guarded", "kind", "cold", "playful"];
    for (let i = 0; i < traits.length; i++) {
      for (let j = 0; j < traits.length; j++) {
        const a: Raw = { name: "Wren Ash", traits: [traits[i], traits[(i + 1) % traits.length], traits[(i + 4) % traits.length]], want: `someone ${traits[j]}`, dealbreaker: "pineapple on pizza" };
        const b: Raw = { name: "Teo Marsh", traits: [traits[j], traits[(j + 2) % traits.length], traits[(j + 5) % traits.length]], want: `someone ${traits[i]}`, dealbreaker: "tardiness" };
        const r = chemistryTest(sheet(a), sheet(b));
        seen.add(r.ending);
        if (r.ending === "disaster") expect(r.score).toBeLessThan(40);
        if (r.ending === "friends") expect(r.score >= 40 && r.score < 70).toBe(true);
        if (r.ending === "second_date") expect(r.score).toBeGreaterThanOrEqual(70);
      }
    }
    expect([...seen].sort()).toEqual([...ENDINGS].sort());
  });

  it("gives exactly three one-line reasons, naming what the engine read", () => {
    const tripped = chemistryTest(sheet({ ...MIRA, dealbreaker: "loud" }), sheet({ ...OTTO, traits: ["warm", "funny", "loud"] }));
    expect(tripped.reasons).toHaveLength(3);
    expect(tripped.reasons.join(" ")).toContain("loud");
    for (const r of [tripped, chemistryTest(sheet(MIRA), sheet(OTTO))]) {
      expect(r.reasons).toHaveLength(3);
      for (const reason of r.reasons) {
        expect(reason).not.toMatch(/\n/);
        expect(reason.length).toBeGreaterThan(10);
        expect(reason.length).toBeLessThanOrEqual(160);
      }
      expect(new Set(r.reasons).size).toBe(3);
    }
    // Otto wants "a curious mind" and Mira is curious: the reasons say so. With a want nobody meets, they say that.
    expect(chemistryTest(sheet(MIRA), sheet(OTTO)).reasons.join(" ")).toContain("“curious”");
    expect(chemistryTest(sheet(MIRA), sheet({ ...OTTO, want: "a quiet night in" })).reasons.join(" ")).toMatch(/Neither one sees what they want/);
    // A trait they share is named.
    expect(chemistryTest(sheet(MIRA), sheet({ ...OTTO, traits: ["bold", "stubborn", "funny"] })).reasons.join(" ")).toContain("“stubborn”");
  });
});

describe("3. the result: a shareable URL that server-renders everything, with both names in og:title", () => {
  it("builds the result's address from the two sheets, and reads it back to the same two", () => {
    const path = resultPath(sheet(MIRA), sheet(OTTO));
    expect(path.startsWith(`${CHEMISTRY_RESULT_PATH}?`)).toBe(true);
    const back = readPair(new URL(path, "http://localhost:3000").searchParams);
    expect(back).toEqual({ ok: true, a: sheet(MIRA), b: sheet(OTTO) });
    // The form's own submission is the same address (a plain GET, fields in this order), so either is the link to share.
    expect(pairQuery(sheet(MIRA), sheet(OTTO))).toBe(new URLSearchParams(form(MIRA, OTTO)).toString());
  });

  it("server-renders both names, the score, the predicted ending and three reasons", async () => {
    const r = chemistryTest(sheet(MIRA), sheet(OTTO));
    const html = await renderResult(form(MIRA, OTTO));
    expect(html).toMatch(/<h1[^>]*>Mira Quell × Otto Brand/);
    expect(html).toContain(`data-chemistry-score="${r.score}"`);
    expect(html).toMatch(new RegExp(`>${r.score}<`));
    expect(html).toContain(`data-chemistry-ending="${r.ending}"`);
    expect(html).toContain(ENDING_LABELS[r.ending]);
    const reasons = [...html.matchAll(/<li[^>]*data-reason[^>]*>([^<]+)<\/li>/g)].map((m) => m[1]);
    expect(reasons).toEqual(r.reasons);
  });

  it("offers the result's own link to copy", async () => {
    const html = await renderResult(form(MIRA, OTTO));
    expect(html).toContain(`value="${resultPath(sheet(MIRA), sheet(OTTO))}"`);
  });

  it("has an og:title and twitter title with both names, the score and the ending, and a share card for this result", async () => {
    const r = chemistryTest(sheet(MIRA), sheet(OTTO));
    const meta = await resultMetadata(searchParams(form(MIRA, OTTO)));
    const og = String(meta.openGraph?.title ?? "");
    for (const part of ["Mira Quell", "Otto Brand", `${r.score}/100`]) expect(og).toContain(part);
    expect(String(meta.twitter?.title ?? "")).toContain("Otto Brand");
    expect(String(meta.title)).toContain("Mira Quell × Otto Brand");
    expect(meta.description).toContain(ENDING_LABELS[r.ending].toLowerCase());
    const images = meta.openGraph?.images;
    const first = Array.isArray(images) ? images[0] : images;
    const image = typeof first === "string" || first instanceof URL ? String(first) : String(first?.url ?? "");
    expect(image).toBe(`${CHEMISTRY_CARD_PATH}?${pairQuery(sheet(MIRA), sheet(OTTO))}`);
    // A result is full of free text: shared, not indexed.
    expect(meta.robots).toMatchObject({ index: false, follow: true });
  });

  it("draws the share card as a PNG for a result, and the tool's card for a refused pair", async () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const q of [pairQuery(sheet(MIRA), sheet(OTTO)), pairQuery(sheet({ ...MIRA, name: "Elon Musk" }), sheet(OTTO)), ""]) {
      const res = await chemistryCardRoute(new NextRequest(`http://localhost:3000${CHEMISTRY_CARD_PATH}?${q}`));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await res.arrayBuffer()).subarray(0, 8)).toEqual(PNG);
    }
  });
});

describe("4. 'Watch the real date' opens /create with both sheets, and the show's rules hold", () => {
  const watchHref = (html: string) => html.match(/<a[^>]*href="(\/create\?[^"]+)"[^>]*>Watch the real date<\/a>/)?.[1];

  it("links 'Watch the real date' to /create with both characters' fields", async () => {
    const href = watchHref(await renderResult(form(MIRA, OTTO)));
    expect(href).toBe(createHref(sheet(MIRA), sheet(OTTO)));
    const q = new URL(href!, "http://localhost:3000").searchParams;
    for (const [k, v] of Object.entries(form(MIRA, OTTO))) expect(q.get(k), k).toBe(v);
  });

  it("/create opens with the first character's sheet filled in, names the second, and builds the second from there", async () => {
    const href = watchHref(await renderResult(form(MIRA, OTTO)))!;
    const create = await renderCreate(new URL(href, "http://localhost:3000").searchParams);
    expect(attr(input(create, "name"), "value")).toBe("Mira Quell");
    expect(attr(input(create, "age"), "value")).toBe("29");
    expect([1, 2, 3].map((i) => attr(input(create, `trait${i}`), "value"))).toEqual(MIRA.traits);
    expect(attr(input(create, "want"), "value")).toBe(MIRA.want);
    expect(attr(input(create, "dealbreaker"), "value")).toBe(MIRA.dealbreaker);
    expect(create).toContain("Otto Brand");
    // The second character's sheet is one click away.
    const second = create.match(/<a[^>]*href="(\/create\?[^"]+)"[^>]*>Build Otto Brand instead<\/a>/)?.[1];
    expect(second).toBe(createHref(sheet(OTTO), sheet(MIRA)));
    const other = await renderCreate(new URL(second!, "http://localhost:3000").searchParams);
    expect(attr(input(other, "name"), "value")).toBe("Otto Brand");
    expect([1, 2, 3].map((i) => attr(input(other, `trait${i}`), "value"))).toEqual(OTTO.traits);
    expect(attr(input(other, "want"), "value")).toBe(OTTO.want);
    expect(attr(input(other, "dealbreaker"), "value")).toBe(OTTO.dealbreaker);
    expect(other).toMatch(/Build Mira Quell instead/);
  });

  it("leaves /create as it was with no sheets, and keeps the ship page's ?name= prefill", async () => {
    expect(attr(input(await renderCreate({}), "name"), "value")).toBe("");
    expect(attr(input(await renderCreate({}), "want"), "value")).toBe("");
    expect(attr(input(await renderCreate({ name: "Juniper" }), "name"), "value")).toBe("Juniper");
  });

  /** What POST /api/characters (the builder's save) answers for one sheet: its message for that problem. */
  async function createMessage(s: Raw): Promise<string> {
    const res = await api.createCharacter(
      { name: s.name, age: Number(s.age ?? 30), bio: "An original character for the chemistry test.", traits: s.traits, want: s.want, dealbreaker: s.dealbreaker, attest: true },
      newUserCookie(),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string; issues?: { message: string }[] };
    return body.message ?? body.issues?.[0]?.message ?? "";
  }

  it.each([
    ["an age under 18", { ...OTTO, age: "16" }, "16"],
    ["a minor in the words", { ...OTTO, want: "a 16 year old who loves maps" }, "year old"],
    ["a teen term", { ...OTTO, traits: ["bold", "teenage", "funny"] as [string, string, string] }, "teenage"],
    ["a real person (blocklist)", { ...OTTO, name: "Taylor Swift" }, "swift"],
    ["a real person, one name", { ...OTTO, name: "Zendaya" }, "zendaya"],
    ["sexual content", { ...OTTO, dealbreaker: "anyone who isn't into bdsm" }, "bdsm"],
    ["sexual content, leetspeak", { ...OTTO, traits: ["bold", "warm", "s3xy"] as [string, string, string] }, "s3xy"],
  ])("refuses %s with the message /create uses, no score, no link to /create, and noindex", async (_label, bad, word) => {
    const expected = await createMessage(bad);
    expect(expected.length).toBeGreaterThan(10);
    for (const q of [form(MIRA, bad), form(bad, MIRA)]) {
      const html = await renderResult(q);
      expect(html).toContain(expected);
      expect(html).not.toMatch(/data-chemistry-score=/);
      expect(watchHref(html)).toBeUndefined();
      expect(readPair(new URLSearchParams(q)).ok).toBe(false);
      const meta = await resultMetadata(searchParams(q));
      expect(meta.robots).toMatchObject({ index: false });
      expect(JSON.stringify(meta).toLowerCase()).not.toContain(word);
      // A refused word is never echoed back (an age under 18 is a number, and the form keeps its other fields).
      if (word !== "16") expect(html.toLowerCase()).not.toContain(word);
      // Nor does /create take a refused sheet from its address.
      const create = await renderCreate(q);
      expect(create.toLowerCase()).not.toContain(word === "16" ? "otto brand" : word);
    }
  });

  it("checks the fields' lengths and the name's words the way /create does, with its messages", async () => {
    const cases: [Raw, string][] = [
      [{ ...OTTO, name: "x".repeat(41) }, "At most 40 characters."],
      [{ ...OTTO, name: "One Two Three Four Five Six" }, "At most 5 words."],
      [{ ...OTTO, traits: ["bold", "y".repeat(31), "funny"] }, "At most 30 characters."],
      [{ ...OTTO, want: "w".repeat(141) }, "At most 140 characters."],
      [{ ...OTTO, dealbreaker: "   " }, "Required."],
      [{ ...OTTO, age: "1001" }, "At most 1000."],
      [{ ...OTTO, age: "20.5" }, "Age must be a whole number."],
    ];
    for (const [bad, message] of cases) {
      const html = await renderResult(form(MIRA, bad));
      expect(html, message).toContain(message);
      expect(html).not.toMatch(/data-chemistry-score=/);
      expect(await createMessage(bad)).toBe(message);
    }
    // No age is fine: the engine never reads it, and /create asks for it.
    expect(readPair(new URLSearchParams(form(MIRA, { ...OTTO, age: "" }))).ok).toBe(true);
  });
});

describe("5. findable: the sitemap, the home page and the footer on /create", () => {
  it("lists the tool in the sitemap (static part and the full sitemap.xml)", async () => {
    const base = "https://botchelor.com";
    expect(staticSitemap(base).map((e) => e.url)).toContain(`${base}${CHEMISTRY_PATH}`);
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain(`${base}${CHEMISTRY_PATH}`);
    expect(urls).toContain(`${base}/tools/ship-name-generator`);
    expect(urls.some((u) => u.includes(CHEMISTRY_RESULT_PATH))).toBe(false);
  });

  it("links both tools from the home page", async () => {
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(`href="${CHEMISTRY_PATH}"`);
    expect(html).toContain('href="/tools/ship-name-generator"');
  });

  it("links both tools from the site footer, on /create", async () => {
    const page = await CreatePage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(await RootLayout({ children: page }));
    const footer = html.match(/<footer[^>]*class="site-footer"[^>]*>[\s\S]*<\/footer>/)?.[0] ?? "";
    expect(footer).toContain(`href="${CHEMISTRY_PATH}"`);
    expect(footer).toContain('href="/tools/ship-name-generator"');
    expect(html).toMatch(/<input[^>]*name="name"/); // it is the builder's page
  });
});

describe("the beacon counts the pages, never what was typed", () => {
  it("counts the tool by its path, and a result as the result page without its query", () => {
    expect(beaconPath(CHEMISTRY_PATH)).toBe(CHEMISTRY_PATH);
    const q = `?${pairQuery(sheet(MIRA), sheet(OTTO))}`;
    expect(beaconPath(CHEMISTRY_RESULT_PATH, q)).toBe(CHEMISTRY_RESULT_PATH);
    expect(beaconPath("/gate", `?from=${encodeURIComponent(`${CHEMISTRY_RESULT_PATH}${q}`)}`)).toBe(CHEMISTRY_RESULT_PATH);
    expect(beaconPath("/create", `?${pairQuery(sheet(MIRA), sheet(OTTO))}`)).toBe("/create");
  });
});
