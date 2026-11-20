/**
 * The free OC tools over MCP (2.32.0, lib/mcp/oc-tools.ts; random_oc 2.44.0): ship_names, oc_chemistry_test, oc_names,
 * oc_question and random_oc give
 * the /tools pages' own answers, refuse what the pages refuse, need no identity, and sit outside the core list.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { chemistryTest } from "@/lib/chemistry-test";
import { CORE_TOOL_ORDER, handleMcpMessage, MCP_TOOLS, PUBLIC_MCP_TOOLS } from "@/lib/mcp";
import { OC_TOOL_NAMES } from "@/lib/mcp/oc-tools";
import { TOOL_IDENTITY } from "@/lib/mcp/reference";
import { ocNames } from "@/lib/oc-names";
import { OC_QUESTIONS } from "@/lib/oc-questions";
import { ocSentence, randomOcs } from "@/lib/random-oc";
import { shipNames } from "@/lib/ship-names";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { startTestDb } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (name: string, args: Any = {}): Promise<Any> =>
  ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, {})) as Any).result;
const data = async (name: string, args: Any = {}): Promise<Any> => {
  const r = await call(name, args);
  expect(r.isError, JSON.stringify(r.structuredContent ?? r.content)).toBeUndefined();
  return r.structuredContent;
};
const refused = async (name: string, args: Any = {}): Promise<string> => {
  const r = await call(name, args);
  expect(r.isError).toBe(true);
  return JSON.stringify(r.structuredContent ?? r.content);
};

const JUNIPER = { name: "Juniper", traits: ["curious", "warm", "bookish"], want: "someone who reads to her", dealbreaker: "rudeness to waiters" };
const DEX = { name: "Dex", traits: ["funny", "loyal", "restless"], want: "an adventure partner", dealbreaker: "people who never laugh" };

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("the free tools' place in the lists", () => {
  it("are served, listed at ?tools=all, outside the core list, read-only and for anyone", () => {
    for (const name of OC_TOOL_NAMES) {
      const def = MCP_TOOLS.find((x) => x.name === name);
      expect(def, name).toBeDefined();
      expect(def!.annotations.readOnlyHint).toBe(true);
      expect(PUBLIC_MCP_TOOLS.some((x) => x.name === name)).toBe(true);
      expect(CORE_TOOL_ORDER as readonly string[]).not.toContain(name);
      expect(TOOL_IDENTITY[name]).toBe("anyone");
    }
  });
});

describe("oc_chemistry_test by id (#1862)", () => {
  it("reads a character's sheet from its id, and refuses an id nobody has", async () => {
    const rafe = HOUSE_CHARACTERS[0];
    const d = await data("oc_chemistry_test", { character_id: rafe.id, b: DEX });
    expect(typeof d.score).toBe("number");
    expect(await refused("oc_chemistry_test", { a: "00000000-0000-4000-8000-000000000000", b: DEX })).toContain("no character you can see");
  });
});

describe("ship_names", () => {
  it("gives the page's ship names and its link", async () => {
    const d = await data("ship_names", { a: "Draco", b: "Harry" });
    expect(d.ship_names).toEqual(shipNames("Draco", "Harry").map((s) => s.name));
    expect(d.ship_names).toContain("Drarry");
    expect(d.url).toMatch(/\/ship\/draco\/harry$/);
    // #1862: a character's id (character_id / with, or the id as a or b) reads as that character's name.
    const rafe = HOUSE_CHARACTERS[0];
    const byId = await data("ship_names", { character_id: rafe.id, with: "Harry" });
    expect(byId.a).toBe(rafe.name);
    expect((await data("ship_names", { a: "Draco", b: "Harry" })).a).toBe("Draco");
    // #1847: name_a / name_b read as a and b.
    expect((await data("ship_names", { name_a: "Draco", name_b: "Harry" })).ship_names).toContain("Drarry");
  });
  it("refuses a bad name and a real person with the page's messages", async () => {
    expect(await refused("ship_names", { a: "D", b: "Harry" })).toContain("2 to");
    expect(await refused("ship_names", { a: "Taylor", b: "Swift" })).toContain("real, well-known person");
  });
});

describe("oc_chemistry_test", () => {
  it("gives the test's score, ending and reasons, the same either way round", async () => {
    const d = await data("oc_chemistry_test", { a: JUNIPER, b: DEX });
    const want = chemistryTest(
      { ...JUNIPER, traits: JUNIPER.traits as [string, string, string] },
      { ...DEX, traits: DEX.traits as [string, string, string] },
    );
    expect(d.score).toBe(want.score);
    expect(d.ending).toBe(want.ending);
    expect(d.reasons).toEqual(want.reasons);
    expect(d.url).toContain("/tools/oc-chemistry-test/result?");
    expect(d.watch_the_real_date).toContain("/create?");
    const flipped = await data("oc_chemistry_test", { a: DEX, b: JUNIPER });
    expect(flipped.score).toBe(d.score);
  });
  it("names the field it refuses as an argument path", async () => {
    const msg = await refused("oc_chemistry_test", { a: JUNIPER, b: { ...DEX, traits: ["funny", "", "restless"] } });
    expect(msg).toContain("b.traits[1]");
    expect(msg).toContain("Required.");
  });
  it("says what to send when nothing is sent", async () => {
    expect(await refused("oc_chemistry_test", { a: {}, b: {} })).toContain("each { name, traits");
  });
});

describe("oc_names", () => {
  it("gives the page's twelve names for a style, kind and batch, each with a create link", async () => {
    const d = await data("oc_names", { style: "gothic", kind: "feminine", batch: 3 });
    expect(d.names.map((n: Any) => n.name)).toEqual(ocNames({ style: "gothic", kind: "feminine", batch: 3 }).map((n) => n.name));
    expect(d.names).toHaveLength(12);
    expect(d.names[0].create_url).toContain("/create?name=");
    expect(d.url).toMatch(/\/tools\/oc-name-generator\/gothic\?kind=feminine&batch=3$/);
    expect(d.more.batch).toBe(4);
  });
  it("mixes every style when none is given; an unknown style or kind is the default, with a warning", async () => {
    const d = await data("oc_names");
    expect(d.style).toBe("mixed");
    expect(new Set(d.names.map((n: Any) => n.style)).size).toBe(5);
    // The server's rule for a value outside an enum: the default, with a warning saying so.
    const odd = await data("oc_names", { style: "steampunk", kind: "other" });
    expect(odd.style).toBe("mixed");
    expect(odd.kind).toBe("any");
    expect(odd.warning).toContain("fantasy");
  });
});

describe("oc_question", () => {
  it("gives today's question with no arguments, one by id, and the next after one", async () => {
    const today = await data("oc_question");
    expect(OC_QUESTIONS.some((q) => q.id === today.id)).toBe(true);
    expect(today.total).toBe(OC_QUESTIONS.length);
    const one = await data("oc_question", { id: "love-3" });
    expect(one.question).toBe(OC_QUESTIONS.find((q) => q.id === "love-3")!.text);
    expect(one.url).toContain("/tools/oc-questions?q=love-3");
    const next = await data("oc_question", { after: "love-3" });
    expect(next.id).toBe(one.next);
    expect(next.id).not.toBe("love-3");
  });
  it("gives a whole theme, refuses an unknown id, and warns on an unknown theme", async () => {
    const d = await data("oc_question", { theme: "deep" });
    expect(d.questions.length).toBe(OC_QUESTIONS.filter((q) => q.theme.id === "deep").length);
    expect(await refused("oc_question", { id: "love-999" })).toContain("love-3");
    const odd = await data("oc_question", { theme: "nope" });
    expect(odd.warning).toContain("basics");
    expect(odd.question).toBeTruthy();
  });
});

describe("random_oc", () => {
  it("gives the page's six characters for a genre, kind and batch, each with create_character's fields and its chemistry", async () => {
    const d = await data("random_oc", { genre: "gothic", kind: "neutral", batch: 3 });
    const page = randomOcs({ genre: "gothic", kind: "neutral", batch: 3 });
    expect(d).toMatchObject({ genre: "gothic", kind: "neutral", batch: 3, more: { batch: 4 } });
    expect(d.url).toMatch(/\/tools\/random-oc-generator\?genre=gothic&kind=neutral&batch=3$/);
    expect(d.characters.map((c: Any) => c.name)).toEqual(page.map((o) => o.name));
    d.characters.forEach((c: Any, i: number) => {
      const oc = page[i];
      expect(c.sentence).toBe(ocSentence(oc));
      expect(c.create_character).toMatchObject({ name: oc.name, age: oc.age, traits: oc.traits, want: oc.want, dealbreaker: oc.dealbreaker });
      expect(c.create_character.bio).toContain(oc.secret);
      expect(c.create_url).toMatch(/\/create\?say=/);
      expect(c.chemistry_with_next.with).toBe(page[(i + 1) % page.length].name);
      expect(c.chemistry_with_next.url).toMatch(/\/tools\/oc-chemistry-test\/result\?/);
    });
  });

  it("mixes every genre when none is given; an unknown genre or kind is the default, with a warning", async () => {
    const d = await data("random_oc");
    expect(d.genre).toBe("mixed");
    expect(d.characters).toHaveLength(6);
    const r = await call("random_oc", { genre: "western", kind: "robot" });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({ genre: "mixed", kind: "any" });
    expect(JSON.stringify(r)).toMatch(/western|genre/);
  });

  it("hands create_character fields it takes as they are (check_only: nothing saved)", async () => {
    const characters = async () => (await t.db.query<Any>(`select count(*)::int as n from characters`)).rows[0].n;
    const before = await characters();
    for (const c of (await data("random_oc", { batch: 2 })).characters.slice(0, 3)) {
      const r = await call("create_character", { ...c.create_character, attest: true, check_only: true });
      expect(r.isError, JSON.stringify(r.structuredContent ?? r.content)).toBeUndefined();
      expect(r.structuredContent).toMatchObject({ saved: false });
    }
    expect(await characters()).toBe(before);
  });

  it("gives two characters oc_chemistry_test takes as a and b", async () => {
    const [a, b] = (await data("random_oc")).characters;
    const pick = (c: Any) => ({ name: c.name, traits: c.traits, want: c.want, dealbreaker: c.dealbreaker });
    const d = await data("oc_chemistry_test", { a: pick(a), b: pick(b) });
    expect(d.score).toBeGreaterThanOrEqual(0);
    expect(d.url).toBe(a.chemistry_with_next.url);
  });
});

