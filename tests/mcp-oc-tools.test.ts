/**
 * The free OC tools over MCP (2.32.0, lib/mcp/oc-tools.ts): ship_names, oc_chemistry_test, oc_names and oc_question give
 * the /tools pages' own answers, refuse what the pages refuse, need no identity, and sit outside the core list.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { chemistryTest } from "@/lib/chemistry-test";
import { CORE_TOOL_ORDER, handleMcpMessage, MCP_TOOLS, PUBLIC_MCP_TOOLS } from "@/lib/mcp";
import { OC_TOOL_NAMES } from "@/lib/mcp/oc-tools";
import { TOOL_IDENTITY } from "@/lib/mcp/reference";
import { ocNames } from "@/lib/oc-names";
import { OC_QUESTIONS } from "@/lib/oc-questions";
import { shipNames } from "@/lib/ship-names";
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

describe("the four tools' place in the lists", () => {
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

describe("ship_names", () => {
  it("gives the page's ship names and its link", async () => {
    const d = await data("ship_names", { a: "Draco", b: "Harry" });
    expect(d.ship_names).toEqual(shipNames("Draco", "Harry").map((s) => s.name));
    expect(d.ship_names).toContain("Drarry");
    expect(d.url).toMatch(/\/ship\/draco\/harry$/);
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
