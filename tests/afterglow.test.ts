import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as repairRoute } from "@/app/api/admin/afterglow/route";
import {
  afterglowWorthKeeping,
  buildAfterglowMessages,
  parseAfterglowLine,
  readAfterglowLine,
  setAfterglowEnabledForTests,
  simulateAfterglow,
  AfterglowError,
  type AfterglowLine,
} from "@/lib/afterglow";
import { writeMissingAfterglow } from "@/lib/afterglow-repair";
import { loadChain } from "@/lib/text-chain";
import {
  deterministicEngine,
  NEUTRAL_SIGNALS,
  type CharacterSheet,
  type DateInput,
  type Outcome,
  type SideOutcome,
  type SideSetup,
} from "@/lib/engine";
import { assembleCharacter, type Character } from "@/lib/character";
import type { StoredSoul } from "@/lib/souls";
import type { Model } from "@/lib/model";
import { AFTERGLOW_TURNS, afterglowVerdictKind } from "@/lib/rules";
import {
  api,
  BASE_URL,
  episodeJson,
  HOUSE_PARTNER_ID,
  newUserCookie,
  scriptedModel,
  scriptOutcome,
  startTestDb,
  userIdOf,
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
// Soul text now reaches the model via the assembled Character; the markers prove each agent gets only its own.
const soul = (marker: string): StoredSoul =>
  ({ values: `honesty ${marker}`, insecurities: "", humor: "", boundaries: "", romantic: "", communication: "", local_only: false, signals: null });
const CHARS: [Character, Character] = [
  assembleCharacter({ id: "mira-oc", sheet: sheetA, soul: soul(ALPHA), memory: null }),
  assembleCharacter({ id: "rafe-house", sheet: sheetB, soul: soul(BETA), memory: null }),
];
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
    const a = content(buildAfterglowMessages(INPUT, OUTCOME, CHARS, "rooftop_bar", "classic", [], 0).messages); // A texts
    expect(a).toContain(ALPHA); // A sees its own soul
    expect(a).not.toContain(BETA); // never B's soul
    expect(a).not.toContain("Test whether the other is sincere"); // never B's agenda label

    const b = content(buildAfterglowMessages(INPUT, OUTCOME, CHARS, "rooftop_bar", "classic", [], 1).messages); // B texts
    expect(b).toContain(BETA);
    expect(b).not.toContain(ALPHA);
    expect(b).not.toContain("Find someone adventurous");
  });

  it("each side is privately told its own engine-decided feeling", () => {
    const a = content(buildAfterglowMessages(INPUT, OUTCOME, CHARS, "rooftop_bar", "classic", [], 0).messages);
    expect(a).toContain("want to see this person again");
    const b = content(buildAfterglowMessages(INPUT, OUTCOME, CHARS, "rooftop_bar", "classic", [], 1).messages);
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
    const thread: AfterglowLine[] = await simulateAfterglow(afterglowModel(AFTERGLOW_TURNS), INPUT, OUTCOME, CHARS, "rooftop_bar", "classic");
    expect(thread).toHaveLength(AFTERGLOW_TURNS);
    expect(thread.map((t) => t.side)).toEqual(["a", "b", "a", "b"]);
  });

  it("throws when a text can't be produced (the caller stores an empty thread)", async () => {
    const dud: Model = { async complete() { return "not json"; } };
    await expect(simulateAfterglow(dud, INPUT, OUTCOME, CHARS, "rooftop_bar", "classic")).rejects.toBeInstanceOf(AfterglowError);
  });

  it("reads a text that comes fenced or wrapped in a sentence, and says why a reply isn't one", () => {
    expect(parseAfterglowLine("```json\n" + lineJson("fenced") + "\n```", "a")?.text).toBe("fenced");
    expect(parseAfterglowLine(`Here's my text:\n${lineJson("wrapped")}\nHope that works!`, "b")).toEqual({ side: "b", text: "wrapped" });
    expect(parseAfterglowLine("```\nSure: " + lineJson("both") + "\n```", "a")?.text).toBe("both");
    expect(readAfterglowLine("no object here", "a")).toEqual({ why: "not_json" });
    expect(readAfterglowLine("{ broken", "a")).toEqual({ why: "not_json" });
    expect(readAfterglowLine(JSON.stringify({ message: "wrong key" }), "a")).toEqual({ why: "shape" });
    expect(readAfterglowLine(JSON.stringify({ text: "we should bring my 9 year old next time" }), "a")).toEqual({ why: "unsafe" });
  });
});

/** `good` texts, then nothing but replies that aren't texts. */
function failingAfter(good: number): Model {
  let n = 0;
  return { async complete() { return n++ < good ? lineJson(`SECRETWORDS text ${n}`) : "I'd rather not say"; } };
}

describe("afterglow — a text that fails ends the exchange, and what was written is kept", () => {
  it("keeps the texts already written once both have texted, and reports why it stopped without a word of them", async () => {
    const cut: string[][] = [];
    const thread = await simulateAfterglow(failingAfter(2), INPUT, OUTCOME, CHARS, "rooftop_bar", "classic", 4, {}, [], undefined, null, (r) => cut.push(r));
    expect(thread.map((t) => t.side)).toEqual(["a", "b"]);
    // Told once: the third text, tried twice, wasn't JSON either time. Reasons only.
    expect(cut).toEqual([["afterglow_2_not_json", "afterglow_2_not_json"]]);
    expect(JSON.stringify(cut)).not.toContain("SECRETWORDS");
  });

  it("three of four is an exchange too: nobody texts past the text that was never sent", async () => {
    const thread = await simulateAfterglow(failingAfter(3), INPUT, OUTCOME, CHARS, "rooftop_bar", "classic");
    expect(thread.map((t) => t.side)).toEqual(["a", "b", "a"]);
  });

  it("one text nobody answered isn't an exchange: the thread is dropped, with the reasons on the error", async () => {
    const err = await simulateAfterglow(failingAfter(1), INPUT, OUTCOME, CHARS, "rooftop_bar", "classic").catch((e) => e);
    expect(err).toBeInstanceOf(AfterglowError);
    expect((err as AfterglowError).reasons).toEqual(["afterglow_1_not_json", "afterglow_1_not_json"]);
    expect((err as AfterglowError).message).not.toContain("SECRETWORDS");
  });

  it("a model error is a reason too, and a whole thread reports nothing", async () => {
    let n = 0;
    const down: Model = { async complete() { if (n++ < 2) return lineJson(`text ${n}`); throw new Error("boom with details"); } };
    const cut: string[][] = [];
    expect(await simulateAfterglow(down, INPUT, OUTCOME, CHARS, "rooftop_bar", "classic", 4, {}, [], undefined, null, (r) => cut.push(r))).toHaveLength(2);
    expect(cut).toEqual([["model_error", "model_error"]]);
    const whole: string[][] = [];
    await simulateAfterglow(afterglowModel(4), INPUT, OUTCOME, CHARS, "rooftop_bar", "classic", 4, {}, [], undefined, null, (r) => whole.push(r));
    expect(whole).toEqual([]);
  });

  it("ghosted keeps meaning ghosted: the silent side never texts, and the other's first text alone is kept", async () => {
    // Whole: only A texts (B went quiet under the date's own answers), and A is told nobody has replied.
    const seen: string[] = [];
    const model: Model = { async complete(messages) { seen.push(content(messages)); return lineJson(`text ${seen.length}`); } };
    const whole = await simulateAfterglow(model, INPUT, OUTCOME, CHARS, "rooftop_bar", "classic", 4, {}, [], undefined, "b");
    expect(whole.map((t) => t.side)).toEqual(["a", "a"]);
    expect(seen[1]).toContain("they_havent_replied");
    // Cut short: A's first text is the whole point of a ghosting, so one is enough.
    expect((await simulateAfterglow(failingAfter(1), INPUT, OUTCOME, CHARS, "rooftop_bar", "classic", 4, {}, [], undefined, "b")).map((t) => t.side)).toEqual(["a"]);
    // A kept thread on a date nobody ghosted always has both of them in it, so the phone never marks it "ghosted".
    expect(afterglowWorthKeeping([{ side: "a", text: "x" }, { side: "a", text: "y" }])).toBe(false);
    expect(afterglowWorthKeeping([{ side: "a", text: "x" }], "b")).toBe(true);
    expect(afterglowWorthKeeping([], "b")).toBe(false);
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

describe("afterglow — the owners read it straight away", () => {
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

  it("the owner of a house date reads the thread and the verdict straight away, with nothing to open", async () => {
    const creator = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), creator)).json();
    scriptOutcome({ ending: "second_date", sides: [sideOutcome(true), sideOutcome(true)] });
    script();
    const created = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator)).json();

    const view = await (await api.getEpisode(created.id, creator)).json();
    expect(view.afterglow.revealed).toBe(true);
    expect(view.afterglow.thread).toHaveLength(4);
    expect(view.afterglow.verdict).toEqual({ a_wants: true, b_wants: true });

    // The old "open" call still answers (older agent clients use it), now with the thread itself.
    const opened = await api.openAfterglow(created.id, creator);
    expect(opened.status).toBe(200);
    const body = await opened.json();
    expect(body.afterglow_revealed).toBe(true);
    expect(body.thread).toHaveLength(4);
    expect(body.verdict).toEqual({ a_wants: true, b_wants: true });
  });

  it("on a two-owner date each owner reads it without the other agreeing; a spectator never sees it", async () => {
    const host = newUserCookie();
    const partner = newUserCookie();
    await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), partner)).json();
    const hostCharacter = await (await api.createCharacter(validCharacter(), host)).json();
    scriptOutcome({ ending: "friends", sides: [sideOutcome(true), sideOutcome(false)] });
    script();
    const created = await (await api.createEpisode({ character_id: hostCharacter.id, blind: true }, host)).json();

    for (const owner of [host, partner]) {
      const view = await (await api.getEpisode(created.id, owner)).json();
      expect(view.afterglow.thread).toHaveLength(4);
      expect(view.afterglow.verdict).toEqual({ a_wants: true, b_wants: false });
    }

    // A spectator sees no afterglow at all, and can't fetch it through the old open call either.
    const spectator = newUserCookie();
    const seen = await (await api.getEpisode(created.id, spectator)).json();
    expect(seen.afterglow).toBeUndefined();
    expect((await api.openAfterglow(created.id, spectator)).status).toBe(403);
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

  it("a date whose third text failed keeps the first two, logs why without their words, and the phone holds them unmarked", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const creator = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), creator)).json();
    scriptOutcome({ ending: "second_date", sides: [sideOutcome(true), sideOutcome(true)] });
    scriptedModel([episodeJson(), lineJson("FUNNIGHTWORDS"), lineJson("it was"), new Error("down"), new Error("down")]);
    const created = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator)).json();
    expect(created.status).toBe("ready");

    const view = await (await api.getEpisode(created.id, creator)).json();
    expect(view.afterglow.thread.map((l: AfterglowLine) => l.side)).toEqual(["a", "b"]);

    // The job's log line: which date, how many were kept, the reasons. Never a text.
    const line = warn.mock.calls.find((c) => String(c[0]).includes("morning-after texts"));
    expect(line).toBeDefined();
    expect(line!.join(" ")).toContain(created.id);
    expect(line!.join(" ")).toContain("(kept 2)");
    expect(line!.join(" ")).toContain("model_error");
    expect(warn.mock.calls.flat().join(" ")).not.toContain("FUNNIGHTWORDS");

    // The couple's phone: held until the date airs (two texts), and never the "ghosted" marker.
    const chain = await loadChain(t.db, character.id, HOUSE_PARTNER_ID, { userId: userIdOf(creator), owner: true });
    const events = chain.flatMap((i) => (i.kind === "event" ? [i] : []));
    expect(events.find((e) => e.event === "afterglow_held")).toMatchObject({ count: 2 });
    expect(events.some((e) => e.event === "ghosted")).toBe(false);
    warn.mockRestore();
  });
});

describe("afterglow — writing the texts a date aired without (lib/afterglow-repair.ts, POST /api/admin/afterglow)", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
    setAfterglowEnabledForTests(true);
  });
  afterAll(async () => {
    setAfterglowEnabledForTests(false);
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const LINES = [
    { side: "a", act: 1, dialogue: "You brought a map to dinner.", action: "", emotion: "amused", interest: 0.6 },
    { side: "b", act: 1, dialogue: "It's a menu. I drew it myself.", action: "", emotion: "proud", interest: 0.7 },
  ];
  /** A ready date whose morning-after texts all failed, with the lines it was played from. */
  async function dateWithoutTexts(ending: "second_date" | "disaster" = "second_date") {
    const creator = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), creator)).json();
    scriptOutcome({ ending, sides: [sideOutcome(true), sideOutcome(true)] });
    scriptedModel([episodeJson(), new Error("down"), new Error("down")]);
    const created = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator)).json();
    await t.db.query(`update episodes set transcript = $2::jsonb where id = $1`, [created.id, JSON.stringify(LINES)]);
    return { id: created.id as string, creator };
  }
  const stored = async (id: string) =>
    (await t.db.query<{ afterglow: AfterglowLine[]; ending: string; sides: unknown; box_score: unknown; ending_detail: string | null }>(`select afterglow, ending, sides, box_score, ending_detail from episodes where id = $1`, [id])).rows[0];
  const post = (body: unknown, key?: string) =>
    repairRoute(new Request(`${BASE_URL}/api/admin/afterglow`, { method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-frontier-key": key } : {}) }, body: JSON.stringify(body) }));

  it("writes the missing texts once, from the stored date, and touches nothing that was decided", async () => {
    const { id, creator } = await dateWithoutTexts();
    const before = await stored(id);
    expect(before.afterglow).toEqual([]);

    const { calls } = scriptedModel([lineJson("fun night"), lineJson("it was"), lineJson("again?"), lineJson("ask me")]);
    expect(await writeMissingAfterglow(t.db, id)).toEqual({ ok: true, written: 4, already: 0 });
    // The two text about the date as it was said.
    expect(content(calls[0])).toContain("You brought a map to dinner.");
    const after = await stored(id);
    expect(after.afterglow.map((l) => l.side)).toEqual(["a", "b", "a", "b"]);
    expect({ ...after, afterglow: [] }).toEqual(before);
    // Its owner reads them like any others.
    expect((await (await api.getEpisode(id, creator)).json()).afterglow.thread).toHaveLength(4);

    // Asked again: nothing is written and no model is called (the script would throw: it has run out).
    scriptedModel([]);
    expect(await writeMissingAfterglow(t.db, id)).toEqual({ ok: true, written: 0, already: 4 });
    expect((await stored(id)).afterglow).toEqual(after.afterglow);
  });

  it("refuses what it shouldn't write: no such date, an agent's date, a date with no lines; a failure leaves it empty", async () => {
    expect(await writeMissingAfterglow(t.db, "nope")).toEqual({ ok: false, reason: "episode_not_found" });

    const { id } = await dateWithoutTexts();
    scriptedModel([lineJson("only one"), "not a text", "not a text"]);
    expect(await writeMissingAfterglow(t.db, id)).toEqual({ ok: false, reason: "texts_failed", detail: "afterglow_1_not_json, afterglow_1_not_json" });
    expect((await stored(id)).afterglow).toEqual([]);

    await t.db.query(`update episodes set performed_by = 'agent' where id = $1`, [id]);
    expect(await writeMissingAfterglow(t.db, id)).toEqual({ ok: false, reason: "performed_by_agent" });
    await t.db.query(`update episodes set performed_by = 'platform', transcript = '[]' where id = $1`, [id]);
    expect(await writeMissingAfterglow(t.db, id)).toEqual({ ok: false, reason: "no_conversation" });
  });

  it("the route is the admin's: no key no write; with it, counts and reasons but never the texts", async () => {
    const PW = ["pw", "for", "afterglow", "tests"].join("-");
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    const { id } = await dateWithoutTexts();
    expect((await post({ episode_id: id })).status).toBe(401);
    expect((await post({ episode_id: id }, "wrong")).status).toBe(401);
    expect((await stored(id)).afterglow).toEqual([]);

    scriptedModel([lineJson("ROUTEWORDS one"), lineJson("two"), lineJson("three"), lineJson("four")]);
    const res = await post({ episode_id: id }, PW);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ episode_id: id, ok: true, written: 4, already: 0 });
    expect(JSON.stringify(body)).not.toContain("ROUTEWORDS");
    expect((await (await post({ episode_id: id }, PW)).json())).toEqual({ episode_id: id, ok: true, written: 0, already: 4 });
    expect((await post({ episode_id: "nope" }, PW)).status).toBe(404);
  });
});
