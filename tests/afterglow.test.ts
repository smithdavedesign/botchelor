import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildAfterglowMessages,
  parseAfterglowLine,
  setAfterglowEnabledForTests,
  simulateAfterglow,
  AfterglowError,
  type AfterglowLine,
} from "@/lib/afterglow";
import {
  deterministicEngine,
  NEUTRAL_SIGNALS,
  type CharacterSheet,
  type DateInput,
  type Outcome,
  type SideOutcome,
  type SideSetup,
} from "@/lib/engine";
import type { Model } from "@/lib/model";
import { AFTERGLOW_TURNS, afterglowVerdictKind } from "@/lib/rules";
import {
  api,
  episodeJson,
  HOUSE_PARTNER_ID,
  newUserCookie,
  scriptedModel,
  scriptOutcome,
  startTestDb,
  validCharacter,
} from "./helpers";

const ALPHA = "ALPHASOULSECRET";
const BETA = "BETASOULSECRET";
const sheetA: CharacterSheet = { name: "Mira", age: 27, bio: "a cartographer", traits: ["curious", "warm"], want: "a map reader", dealbreaker: "hates surprises", house: false };
const sheetB: CharacterSheet = { name: "Rafe", age: 30, bio: "a baker", traits: ["dramatic", "kind"], want: "an honest taste-tester", dealbreaker: "liars", house: true };
const side = (sheet: CharacterSheet, agendaId: "find_adventurous" | "test_sincerity"): SideSetup => ({
  sheet, signals: NEUTRAL_SIGNALS, autonomy: "balanced", strategy: "genuine_chemistry", agendaId, note: null, gameBudget: 25,
});
const INPUT: DateInput = { a: side(sheetA, "find_adventurous"), b: side(sheetB, "test_sincerity") };
const SOULS: [string, string] = [`Values honesty. ${ALPHA}`, `Values sincerity. ${BETA}`];
const sideOutcome = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
const OUTCOME: Outcome = { ...deterministicEngine.decide(INPUT, 1), sides: [sideOutcome(true), sideOutcome(false)] };

const lineJson = (text: string) => JSON.stringify({ text });
function afterglowModel(n: number): Model {
  const queue = Array.from({ length: n }, (_, i) => lineJson(`morning-after text ${i}`));
  return { async complete() { return queue.shift() ?? lineJson("extra"); } };
}
const content = (messages: { role: string; content: string }[]) =>
  messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");

describe("afterglow — privacy and feeling", () => {
  it("an agent never sees the other side's soul or secret agenda", () => {
    const a = content(buildAfterglowMessages(INPUT, OUTCOME, SOULS, "rooftop_bar", "classic", [], 0).messages); // A texts
    expect(a).toContain(ALPHA); // A sees its own soul
    expect(a).not.toContain(BETA); // never B's soul
    expect(a).not.toContain("Test whether the other is sincere"); // never B's agenda label

    const b = content(buildAfterglowMessages(INPUT, OUTCOME, SOULS, "rooftop_bar", "classic", [], 1).messages); // B texts
    expect(b).toContain(BETA);
    expect(b).not.toContain(ALPHA);
    expect(b).not.toContain("Find someone adventurous");
  });

  it("each side is privately told its own engine-decided feeling", () => {
    const a = content(buildAfterglowMessages(INPUT, OUTCOME, SOULS, "rooftop_bar", "classic", [], 0).messages);
    expect(a).toContain("want to see this person again");
    const b = content(buildAfterglowMessages(INPUT, OUTCOME, SOULS, "rooftop_bar", "classic", [], 1).messages);
    expect(b).toContain("do NOT want to see this person again");
  });
});

describe("afterglow — parsing and running", () => {
  it("parses a valid text, rejects non-JSON and unsafe content", () => {
    expect(parseAfterglowLine(lineJson("had a lovely time"), "a")?.text).toBe("had a lovely time");
    expect(parseAfterglowLine("not json", "a")).toBeNull();
    expect(parseAfterglowLine(JSON.stringify({ text: "we should bring my 9 year old next time" }), "a")).toBeNull();
  });

  it("runs the whole thread, alternating A then B", async () => {
    const thread: AfterglowLine[] = await simulateAfterglow(afterglowModel(AFTERGLOW_TURNS), INPUT, OUTCOME, SOULS, "rooftop_bar", "classic");
    expect(thread).toHaveLength(AFTERGLOW_TURNS);
    expect(thread.map((t) => t.side)).toEqual(["a", "b", "a", "b"]);
  });

  it("throws when a text can't be produced (the caller stores an empty thread)", async () => {
    const dud: Model = { async complete() { return "not json"; } };
    await expect(simulateAfterglow(dud, INPUT, OUTCOME, SOULS, "rooftop_bar", "classic")).rejects.toBeInstanceOf(AfterglowError);
  });
});

describe("afterglow — the verdict", () => {
  it("reads mutual, one-sided or neither from the two wants_another flags", () => {
    expect(afterglowVerdictKind(true, true)).toBe("mutual_yes");
    expect(afterglowVerdictKind(false, false)).toBe("mutual_no");
    expect(afterglowVerdictKind(true, false)).toBe("one_sided");
    expect(afterglowVerdictKind(false, true)).toBe("one_sided");
  });
});

describe("afterglow — owner-controlled reveal", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
    setAfterglowEnabledForTests(true); // this file is about the afterglow; generate it inline
  });
  afterAll(async () => {
    setAfterglowEnabledForTests(false);
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });

  /** One narration + four afterglow texts, the model calls the inline job makes with conversation off. */
  const script = () => scriptedModel([episodeJson(), lineJson("fun night"), lineJson("it was"), lineJson("again?"), lineJson("ask me")]);

  it("a house date opens with the single owner's consent, then shows the thread and verdict", async () => {
    const creator = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), creator)).json();
    scriptOutcome({ ending: "second_date", sides: [sideOutcome(true), sideOutcome(true)] });
    script();
    const created = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator)).json();

    const before = await (await api.getEpisode(created.id, creator)).json();
    expect(before.afterglow).toBeDefined();
    expect(before.afterglow.revealed).toBe(false);
    expect(before.afterglow.needed).toBe(1);
    expect(before.afterglow.thread).toBeUndefined();

    const opened = await api.openAfterglow(created.id, creator);
    expect(opened.status).toBe(201);

    const after = await (await api.getEpisode(created.id, creator)).json();
    expect(after.afterglow.revealed).toBe(true);
    expect(after.afterglow.thread).toHaveLength(4);
    expect(after.afterglow.verdict).toEqual({ a_wants: true, b_wants: true });
  });

  it("a two-owner date needs both; a spectator never sees it", async () => {
    const host = newUserCookie();
    const partner = newUserCookie();
    await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), partner)).json();
    const hostCharacter = await (await api.createCharacter(validCharacter(), host)).json();
    scriptOutcome({ ending: "friends", sides: [sideOutcome(true), sideOutcome(false)] });
    script();
    const created = await (await api.createEpisode({ character_id: hostCharacter.id, blind: true }, host)).json();

    // The host opens first: still locked, 1 of 2.
    await api.openAfterglow(created.id, host);
    let view = await (await api.getEpisode(created.id, host)).json();
    expect(view.afterglow.revealed).toBe(false);
    expect(view.afterglow.consents).toBe(1);
    expect(view.afterglow.needed).toBe(2);

    // The partner opens: now revealed for both owners.
    await api.openAfterglow(created.id, partner);
    view = await (await api.getEpisode(created.id, partner)).json();
    expect(view.afterglow.revealed).toBe(true);
    expect(view.afterglow.thread).toHaveLength(4);

    // A spectator sees no afterglow at all (it is private between the owners).
    const spectator = newUserCookie();
    const seen = await (await api.getEpisode(created.id, spectator)).json();
    expect(seen.afterglow).toBeUndefined();
  });

  it("a failed afterglow leaves the episode ready with no thread (best effort)", async () => {
    const creator = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), creator)).json();
    scriptOutcome({ ending: "disaster" });
    scriptedModel([episodeJson(), new Error("afterglow down"), new Error("afterglow down")]);
    const created = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator)).json();
    expect(created.status).toBe("ready");

    const view = await (await api.getEpisode(created.id, creator)).json();
    expect(view.afterglow).toBeUndefined(); // no thread was produced, so nothing to open
  });
});
