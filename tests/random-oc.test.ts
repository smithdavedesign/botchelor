/**
 * The random OC generator (lib/random-oc.ts, app/tools/random-oc-generator): whole characters, six a page, the same page
 * for the same address, every one an adult the show's filter takes, and each one goes on into /create (one sentence) and
 * the OC chemistry test (with the next character on the page) without either refusing it.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RandomOcPage, { generateMetadata } from "@/app/tools/random-oc-generator/page";
import { chemistryQuery, readChemistry } from "@/lib/chemistry-test";
import { EXPRESS_TEXT_MAX, EXPRESS_TEXT_MIN } from "@/lib/express-create";
import { OC_NAME_KINDS } from "@/lib/oc-names";
import {
  createFromOc,
  ocSentence,
  RANDOM_OC_AGE_MAX,
  RANDOM_OC_AGE_MIN,
  RANDOM_OC_GENRES,
  RANDOM_OC_LIMITS,
  RANDOM_OC_PATH,
  RANDOM_OCS_SHOWN,
  randomOcHref,
  randomOcs,
  readGenre,
  readOcBatch,
} from "@/lib/random-oc";
import { checkSheetText } from "@/lib/safety";
import { FREE_TOOLS, RANDOM_OC_TOOL_PATH } from "@/lib/tools";

const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("randomOcs", () => {
  it("is the same page for the same address, and another for the next batch", () => {
    expect(randomOcs({ genre: "cozy", kind: "feminine", batch: 3 })).toEqual(randomOcs({ genre: "cozy", kind: "feminine", batch: 3 }));
    expect(randomOcs({ batch: 2 }).map((o) => o.name)).not.toEqual(randomOcs({ batch: 1 }).map((o) => o.name));
  });

  it("gives six whole characters on every page: adults, nothing twice, within /create's limits, all of them taken by the filter", () => {
    for (const genre of [null, ...RANDOM_OC_GENRES]) {
      for (const kind of OC_NAME_KINDS) {
        for (let batch = 1; batch <= 25; batch++) {
          const ocs = randomOcs({ genre, kind, batch });
          const where = `${genre}/${kind}/${batch}`;
          expect(ocs, where).toHaveLength(RANDOM_OCS_SHOWN);
          for (const key of ["name", "role", "quirk", "want", "secret"] as const) expect(new Set(ocs.map((o) => o[key])).size, `${where} ${key}`).toBe(RANDOM_OCS_SHOWN);
          for (const oc of ocs) {
            if (genre) expect(oc.genre).toBe(genre);
            if (kind !== "any") expect(oc.kind).toBe(kind);
            expect(oc.age).toBeGreaterThanOrEqual(RANDOM_OC_AGE_MIN);
            expect(oc.age).toBeLessThanOrEqual(RANDOM_OC_AGE_MAX);
            expect(new Set(oc.traits).size).toBe(3);
            for (const t of oc.traits) expect(t.length).toBeLessThanOrEqual(RANDOM_OC_LIMITS.trait);
            expect(oc.want.length).toBeLessThanOrEqual(RANDOM_OC_LIMITS.want);
            expect(oc.dealbreaker.length).toBeLessThanOrEqual(RANDOM_OC_LIMITS.dealbreaker);
            const sentence = ocSentence(oc);
            expect(sentence.length, sentence).toBeLessThanOrEqual(EXPRESS_TEXT_MAX);
            expect(sentence.length).toBeGreaterThanOrEqual(EXPRESS_TEXT_MIN);
            expect(sentence.startsWith(`${oc.name} (${oc.pronouns}), ${oc.age}, `)).toBe(true);
            expect(checkSheetText({ name: oc.name, bio: sentence }).ok, sentence).toBe(true);
          }
        }
      }
    }
  });

  it("mixes every genre on the plain page", () => {
    expect(new Set(randomOcs({}).map((o) => o.genre)).size).toBe(RANDOM_OC_GENRES.length);
  });

  it("hands each character and the next one to the chemistry test, which reads them as given", () => {
    for (let batch = 1; batch <= 40; batch++) {
      const ocs = randomOcs({ batch });
      ocs.forEach((oc, i) => {
        const partner = ocs[(i + 1) % ocs.length];
        const read = readChemistry(Object.fromEntries(new URLSearchParams(chemistryQuery(oc, partner))));
        expect(read.ok, `${oc.name} × ${partner.name}: ${JSON.stringify(read)}`).toBe(true);
        if (read.ok) expect(read.a).toEqual({ name: oc.name, traits: oc.traits, want: oc.want, dealbreaker: oc.dealbreaker });
      });
    }
  });

  it("sends a character to /create as the one-sentence box's text", () => {
    const [oc] = randomOcs({});
    const href = createFromOc(oc);
    expect(href.startsWith("/create?say=")).toBe(true);
    expect(new URL(href, "https://x.test").searchParams.get("say")).toBe(ocSentence(oc));
  });
});

describe("addresses", () => {
  it("reads a genre, a batch and builds the address back", () => {
    expect(readGenre("Sci-Fi")).toBe("scifi");
    expect(readGenre("western")).toBeNull();
    expect(readOcBatch("7")).toBe(7);
    expect(readOcBatch("0")).toBe(1);
    expect(readOcBatch("abc")).toBe(1);
    expect(readOcBatch("1000")).toBe(1);
    expect(randomOcHref(null)).toBe(RANDOM_OC_PATH);
    expect(randomOcHref("gothic", "neutral", 2)).toBe(`${RANDOM_OC_PATH}?genre=gothic&kind=neutral&batch=2`);
  });

  it("is the first of the free tools, at the path the tools list writes out", () => {
    expect(RANDOM_OC_TOOL_PATH).toBe(RANDOM_OC_PATH);
    expect(FREE_TOOLS[0].path).toBe(RANDOM_OC_PATH);
  });
});

describe("the page", () => {
  const render = async (q: Record<string, string> = {}) => text(renderToStaticMarkup(await RandomOcPage({ searchParams: Promise.resolve(q) })));

  it("shows six characters, each with a way into /create and a chemistry result, and six more on the next batch", async () => {
    const html = await render();
    expect(html).toContain("<h1>Random OC generator</h1>");
    expect(html).toContain(`data-ocs="${RANDOM_OCS_SHOWN}"`);
    for (const oc of randomOcs({})) expect(html).toContain(oc.name);
    expect(html.match(/href="\/create\?say=/g)).toHaveLength(RANDOM_OCS_SHOWN);
    expect(html.match(/href="\/tools\/oc-chemistry-test\/result\?/g)).toHaveLength(RANDOM_OCS_SHOWN);
    expect(html).toContain(`href="${RANDOM_OC_PATH}?batch=2"`);
    // The links that open the builder or a result are not for crawlers.
    for (const a of html.match(/<a [^>]*href="\/(create\?say|tools\/oc-chemistry-test\/result)[^>]*>/g) ?? []) expect(a).toContain('rel="nofollow"');
    expect(html).toContain('href="/tools"');
  });

  it("keeps the genre and kind in its links", async () => {
    const html = await render({ genre: "gothic", kind: "neutral" });
    expect(html).toContain(`href="${RANDOM_OC_PATH}?genre=gothic&kind=neutral&batch=2"`);
    for (const oc of randomOcs({ genre: "gothic", kind: "neutral" })) expect(html).toContain(oc.name);
  });

  it("is one page in search: its own canonical, and every other address not indexed", async () => {
    const plain = await generateMetadata({ searchParams: Promise.resolve({}) });
    expect(plain.alternates?.canonical).toBe(RANDOM_OC_PATH);
    expect(plain.robots).toBeUndefined();
    expect(String(plain.description).length).toBeLessThanOrEqual(160);
    const other = await generateMetadata({ searchParams: Promise.resolve({ batch: "2" }) });
    expect(other.alternates?.canonical).toBe(RANDOM_OC_PATH);
    expect(other.robots).toEqual({ index: false, follow: true });
  });
});
