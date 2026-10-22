import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUSE_CHARACTERS, PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { HOUSE_KITS } from "@/lib/house-kits";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { conceptTerms, scoreSheet, surnamesClose, termWeights, twinWhy, type SheetDraft } from "@/lib/originality";
import { startTestDb, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Sheet = SheetDraft & { id: string; name: string };

// The visitor runs' concept twins (docs/agent-visitor-test.md, runs 4 and 5), as near as the reports describe them.
const bertrand: Sheet = {
  id: "bertrand", name: "Bertrand Okonkwo-Laine", bio: "44, works the overnight shift at a ferry terminal ticket desk and keeps a hand-written ledger of every latecomer.",
  traits: ["meticulous", "dry", "quietly hopeful"], want: "Someone who arrives exactly when they said they would", dealbreaker: "Being kept waiting without a word",
  extras: { occupation: "Ferry ticket clerk", lines: { hello: "You're four minutes early. I've noted it." }, tells: { smitten: "stops checking his watch" } },
};
const okonkwoLind: Sheet = {
  id: "okonkwo-lind", name: "Marguerite Okonkwo-Lind", bio: "A 44-year-old night-shift parking warden who logs every car's arrival time in a little notebook.",
  traits: ["exacting", "deadpan", "secretly romantic"], want: "A person who is never late", dealbreaker: "Excuses about traffic",
  extras: { occupation: "Night parking warden", lines: { hello: "You're six minutes early. Interesting." }, tells: { smitten: "forgets to look at the clock" } },
};
const ostrowski: Sheet = {
  id: "ostrowski", name: "Marguerite Ostrowski", bio: "Runs the overnight desk at a 24-hour laundromat and keeps a ledger of whose socks go missing.",
  traits: ["precise", "wry", "lonely"], want: "Someone who keeps their word to the minute", dealbreaker: "People who say 'in a sec'",
  extras: { occupation: "Laundromat night manager", lines: { hello: "You're three minutes early. Good." }, tells: { smitten: "stops watching the door" } },
};
const oyelaran: Sheet = {
  id: "oyelaran", name: "Marguerite Oyelaran", bio: "A night-shift toll collector who scores every driver out of ten in a spiral ledger and never misses a minute.",
  traits: ["exact", "deadpan", "tender"], want: "Someone who is on time without trying", dealbreaker: "Lateness without an apology",
  extras: { occupation: "Toll collector", lines: { hello: "You're five minutes early." }, tells: { smitten: "stops checking the time" } },
};
// #655, the 2026-10-22-0610 run: two agents' lighthouse characters, four minutes apart (their sheets as made). Neither
// gave an occupation; the shared idea (barometers, tide tables) was in their hobbies and profile answers.
const odalysLamp: Sheet = {
  id: "odalys-lamp", name: "Odalys Oyelaran", bio: "A lighthouse-lamp restorer who narrates her own life in maritime weather warnings.",
  traits: ["dry", "meticulous", "secretly sentimental"], want: "someone who will sit through a whole storm without checking their phone",
  dealbreaker: "people who say they are fine with silence and then fill it",
  extras: {
    hobbies: ["barometer collecting", "tide-table poetry"],
    prompts: [{ id: "geek_out", answer: "Fresnel lens prisms and how one bulb becomes a beam" }, { id: "simple_pleasures", answer: "Tea going cold because the barometer is more interesting" }],
  },
};
const thaddeusTides: Sheet = {
  id: "thaddeus-tides", name: "Thaddeus Quillfeather", bio: "A retired lighthouse-keeper turned municipal tide-table auditor who still narrates his commute in nautical bearings.",
  traits: ["pedantic", "tender", "superstitious"], want: "someone who will argue about knots with him without winning", dealbreaker: "anyone who whistles on a boat",
  extras: {
    hobbies: ["knot tying", "barometer collecting"],
    prompts: [{ id: "geek_out", answer: "Tide tables and the exact moment slack water turns" }, { id: "simple_pleasures", answer: "Thermos tea on a cold jetty" }],
  },
};
const house: Sheet[] = [...HOUSE_CHARACTERS, ...PREMIUM_HOUSE_CHARACTERS].map((c) => ({
  id: c.id, name: c.name, bio: c.bio, traits: c.traits, want: c.want, dealbreaker: c.dealbreaker, voice: c.voice, extras: HOUSE_KITS[c.id],
}));
const everyone = [...house, bertrand, okonkwoLind, ostrowski, oyelaran, odalysLamp, thaddeusTides];
const terms = new Map(everyone.map((s) => [s.id, conceptTerms(s)]));
const weight = termWeights([...terms.values()]);
const twin = (a: Sheet, b: Sheet) => twinWhy(a, b, terms.get(a.id) ?? conceptTerms(a), terms.get(b.id) ?? conceptTerms(b), weight);

describe("originality: concept twins (visitor runs 4 and 5)", () => {
  it("near-identical surnames, however they're spelled", () => {
    expect(surnamesClose("Bertrand Okonkwo-Laine", "Marguerite Okonkwo-Lind")).toBe(true);
    expect(surnamesClose("Teodor Vasquez-Lind", "Marguerite Vasquez-Lund")).toBe(true);
    expect(surnamesClose("Odile Ferrante", "Odile Ferranti")).toBe(true);
    expect(surnamesClose("Marguerite Oyelaran", "Marguerite Ostrowski")).toBe(false);
    expect(surnamesClose("Bo Lee", "Al Leo")).toBe(false); // too short to call
  });

  it("flags the runs' twins, by a cluster of shared concepts or by a shared name and some of the story", () => {
    expect(twin(bertrand, okonkwoLind)).toMatchObject({ kind: "concept", why: expect.stringMatching(/Marguerite Okonkwo-Lind/) });
    expect(twin(okonkwoLind, oyelaran)).toMatchObject({ kind: "concept", why: expect.stringMatching(/reads a lot like this one \(both: .*night shift.*\)\.$/) });
    expect(twin(bertrand, oyelaran)?.kind).toBe("concept");
    // Two Marguerites with a ledger and a night shift between them.
    expect(twin(ostrowski, oyelaran)).toMatchObject({ kind: "concept", why: expect.stringMatching(/a name and a story close to this one's/) });
    expect(twin(okonkwoLind, ostrowski)?.kind).toBe("concept");
  });

  it("leaves the house cast alone: no two of them read as twins", () => {
    const flagged: string[] = [];
    for (let i = 0; i < house.length; i++) for (let j = i + 1; j < house.length; j++) {
      const t = twin(house[i], house[j]);
      if (t) flagged.push(`${house[i].name} × ${house[j].name}: ${t.why}`);
    }
    expect(flagged).toEqual([]);
  });

  it("reads hobbies and profile answers: the 0610 run's two lighthouse characters are twins (#655)", () => {
    expect(twin(thaddeusTides, odalysLamp)).toMatchObject({ kind: "concept", why: expect.stringMatching(/^Odalys Oyelaran reads a lot like this one \(both: .*(barometer|tide table).*\)\.$/) });
    expect(twin(odalysLamp, thaddeusTides)?.kind).toBe("concept");
    // Without them, all the two shared was "lighthouse" and "narrate".
    const bare = (x: Sheet): Sheet => ({ ...x, id: `${x.id}-bare`, extras: {} });
    expect(twin(bare(thaddeusTides), bare(odalysLamp))).toBeNull();
  });

  it("a shared first name alone is a lighter nudge, and costs less than reading like someone", () => {
    const florist: Sheet = { id: "florist", name: "Marguerite Bloom", bio: "A florist who names every bouquet after a weather front.", traits: ["sunny", "loud", "generous"], want: "A slow walk through a covered market", dealbreaker: "Plastic flowers" };
    const t = twin(florist, oyelaran)!;
    expect(t).toMatchObject({ kind: "name", why: expect.stringMatching(/There's already someone called Marguerite on the show \(Marguerite Oyelaran\)\. Two on one date blur together/) });
    const named = scoreSheet(florist, [], [t]);
    const copied = scoreSheet(florist, [], [{ ...t, kind: "concept", why: "Someone reads a lot like this one." }]);
    expect(named.score - copied.score).toBe(10);
    expect(named.tips[0]).toBe(t.why); // its own advice, not "what makes yours different?"
  });
});

describe("check_originality and create_character see them on the show", () => {
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
  const call = async (name: string, args: Record<string, unknown>): Promise<Any> =>
    ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, {})) as Any).result;
  const sheet = ({ id: _id, ...s }: Sheet) => ({ ...validCharacter({ name: s.name }), ...s, age: 44 });

  it("a second agent's Marguerite hears about the first one", async () => {
    const first = (await call("create_character", { ...sheet(oyelaran), attest: true })).structuredContent;
    expect(first.originality.similar).toEqual([]);
    const checked = (await call("check_originality", sheet(ostrowski))).structuredContent.originality;
    expect(checked.similar).toEqual([expect.objectContaining({ id: first.character.id, name: "Marguerite Oyelaran", kind: "concept" })]);
    expect(checked.score).toBeLessThan(100);
  });

  it("an agent making the 0610 run's lighthouse-keeper minutes after another agent's hears about it, before and at the save (#655)", async () => {
    const session = async (): Promise<McpContext> => {
      const ctx: McpContext = {};
      await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-originality-test" } } }, ctx);
      return { sessionId: ctx.issuedSessionId };
    };
    const as = async (ctx: McpContext, name: string, args: Record<string, unknown>): Promise<Any> =>
      ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx)) as Any).result;
    const first = (await as(await session(), "create_character", sheet(odalysLamp))).structuredContent;
    const second = await session();
    const checked = (await as(second, "check_originality", sheet(thaddeusTides))).structuredContent.originality;
    expect(checked.similar).toEqual([expect.objectContaining({ id: first.character.id, name: "Odalys Oyelaran", kind: "concept" })]);
    expect(checked.score).toBeLessThan(70); // 70 in the run, with nothing flagged
    const made = (await as(second, "create_character", sheet(thaddeusTides))).structuredContent;
    expect(made.look_alikes).toEqual([expect.objectContaining({ id: first.character.id, name: "Odalys Oyelaran", both: expect.arrayContaining([expect.stringMatching(/barometer|tide table/)]) })]);
  });
});
