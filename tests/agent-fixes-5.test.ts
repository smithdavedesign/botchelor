import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { conceptTerms, termWeights, twinWhy } from "@/lib/originality";
import { airingNote } from "@/lib/own-date";
import { hasSelfTalk, stripSelfTalk } from "@/lib/quality";
import { parseEpisode, repairSelfTalk } from "@/lib/showrunner";
import { startTestDb, validCharacter, validEpisodeDraft } from "./helpers";

// The agent-feedback issues from the 5-run loop on 2026-10-19 still open after #408: #399 (by visibility), #406, #344,
// #360, #338, #403.
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
afterEach(() => {
  vi.restoreAllMocks();
});

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;
async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-fixes-5-test" } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
async function agentWith(name: string, extra: Record<string, unknown> = {}) {
  const ctx = await connect();
  const c = (await call("create_character", validCharacter({ name, keep_name: true, ...extra }), ctx)).structuredContent;
  return { ctx, id: c.character.id as string };
}
const line = { dialogue: "So, what's the strangest map you've drawn?", action: "", emotion: "curious", interest_signal: 0.6 };

describe("#399: a finished date's note follows its visibility", () => {
  it("never tells a private date to air", () => {
    expect(airingNote("private")).toMatch(/never airs/);
    expect(airingNote("private")).not.toMatch(/airs on its own/);
    expect(airingNote("public")).toMatch(/airs on its own/);
    expect(airingNote("unlisted")).not.toMatch(/private/);
  });
});

describe("#406: the model's self-talk never reaches a page", () => {
  const leaked = "A comedy open mic on a Thursday night... wait, no days or times allowed on plans; instead: a comedy open mic in a basement bar, folding chairs and one wobbly spotlight.";

  it("spots a draft correcting itself, and keeps the correction", () => {
    expect(hasSelfTalk(leaked, true)).toBe(true);
    expect(stripSelfTalk(leaked, true)).toBe("A comedy open mic in a basement bar, folding chairs and one wobbly spotlight.");
    // Cut at the aside when there's no "instead:".
    expect(stripSelfTalk("A rooftop garden at dusk, strings of lights... wait, actually no.", true)).toBe("A rooftop garden at dusk, strings of lights.");
  });

  it("leaves a character's own 'wait' alone in scenes and confessionals", () => {
    expect(hasSelfTalk("She laughs. \"Wait, you like jazz?\" he asks, delighted.")).toBe(false);
    expect(hasSelfTalk("Actually, no, I didn't hate it.")).toBe(false);
    expect(hasSelfTalk("A quiet bar by the harbour, half full.", true)).toBe(false);
  });

  it("a draft with self-talk is retried, and the last try is repaired rather than lost", () => {
    const raw = JSON.stringify(validEpisodeDraft({ setting: leaked }));
    const parsed = parseEpisode(raw);
    expect(parsed).toMatchObject({ ok: false, reason: "self_talk" });
    const fixed = repairSelfTalk((parsed as Any).episode);
    expect(fixed.setting).toBe("A comedy open mic in a basement bar, folding chairs and one wobbly spotlight.");
    expect(parseEpisode(JSON.stringify(fixed)).ok).toBe(true);
  });
});

describe("#344: smaller own-date steps", () => {
  it("compact steps shorten the instructions; delta leaves the messages out", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const started = (await call("start_own_date", { character_id: id, partner_id: b }, ctx)).structuredContent.step;
    expect(started.instructions.length).toBeGreaterThan(300);
    const next = (await call("submit_own_date_step", { episode_id: started.episode_id, output: line }, ctx)).structuredContent.step;
    expect(next.instructions).toMatch(/^Turn 2 of \d+: Bo Quill speaks\. As before/);
    expect(next.instructions.length).toBeLessThan(320);
    expect(next.messages.length).toBeGreaterThan(0);
    const delta = (await call("get_own_date_step", { episode_id: started.episode_id, compact: "delta" }, ctx)).structuredContent.step;
    expect(delta).toMatchObject({ delta: true, messages: [], system_unchanged: true });
    expect(delta.last_lines).toEqual([expect.stringMatching(/strangest map/)]);
    const full = (await call("get_own_date_step", { episode_id: started.episode_id, compact: false }, ctx)).structuredContent.step;
    expect(full.instructions.length).toBeGreaterThan(300);
  });
});

describe("#360: a turn in one call", () => {
  it("submit_own_date_step with wait_seconds holds for the other agent's move", async () => {
    const a = await agentWith("Ada Lumen");
    const b = await agentWith("Bo Quill", { open_to_dates: true });
    const step = (await call("start_own_date", { character_id: a.id, partner_id: b.id }, a.ctx)).structuredContent.step;
    const started = Date.now();
    const r = (await call("submit_own_date_step", { episode_id: step.episode_id, output: line, wait_seconds: 1 }, a.ctx)).structuredContent;
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(r).toMatchObject({ accepted: true, still_waiting: true, waited_seconds: expect.any(Number) });
    expect(r.already_your_move).toBeUndefined();
    // Without wait_seconds, nothing changes.
    const plain = (await call("get_own_date_step", { episode_id: step.episode_id }, a.ctx)).structuredContent;
    expect(plain.step.stage).toBe("waiting");
  });
});

describe("#338: swipes in flight on my_status", () => {
  it("shows your likes still waiting by name, and how many liked yours as a count", async () => {
    const a = await agentWith("Ada Lumen", { open_to_dates: true, extras: PROFILE });
    const b = await agentWith("Bo Quill", { open_to_dates: true, extras: PROFILE });
    expect((await call("my_status", {}, a.ctx)).structuredContent.swipes).toBeUndefined();
    await call("swipe", { character_id: a.id, target_id: b.id, like: true }, a.ctx);
    const mine = (await call("my_status", {}, a.ctx)).structuredContent.swipes;
    expect(mine.waiting_on_them).toEqual([expect.objectContaining({ character_id: a.id, with: b.id, name: "Bo Quill" })]);
    const theirs = (await call("my_status", {}, b.ctx)).structuredContent.swipes;
    expect(theirs).toMatchObject({ waiting_on_them: [], liked_you: 1 });
    expect(JSON.stringify(theirs)).not.toMatch(/Ada Lumen/);
    // A like back makes a match: neither list counts it any more.
    await call("swipe", { character_id: b.id, target_id: a.id, like: true }, b.ctx);
    expect((await call("my_status", {}, b.ctx)).structuredContent.swipes).toBeUndefined();
  });
});

describe("#403: the same temperament doing the same kind of thing", () => {
  const ines = {
    id: "ines",
    name: "Ines Varga-Holm",
    bio: "Runs the overnight lost-property desk at a ferry terminal and keeps a ledger of the strangest things people leave behind.",
    traits: ["wry", "patient", "secretly romantic"],
    want: "Someone who asks what the strangest lost thing was, and waits for the whole story",
  };
  const maren = {
    name: "Maren Qvist",
    bio: "Restores broken lighthouse lenses for a coastal trust and keeps a ledger of every stranger who has ever waved at her from a ferry.",
    traits: ["patient", "wry", "superstitious"],
    want: "Someone who will argue happily about nothing for an hour",
  };

  it("flags Maren as reading like Ines", () => {
    const [a, b] = [conceptTerms(maren), conceptTerms(ines)];
    const twin = twinWhy(maren, ines, a, b, termWeights([a, b]));
    expect(twin?.why).toMatch(/same temperament \(wry, patient\)/);
  });

  it("still finds no twins in the house cast", () => {
    const cast = ALL_HOUSE_CHARACTERS as Any[];
    const terms = cast.map((c) => conceptTerms(c));
    const w = termWeights(terms);
    const hits = cast.flatMap((c, i) => cast.filter((_, j) => j !== i && twinWhy(c, cast[j], terms[i], terms[j], w)).map((o) => `${c.name}~${o.name}`));
    expect(hits).toEqual([]);
  });
});
