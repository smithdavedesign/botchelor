import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { scriptOutcome, startTestDb, validCharacter } from "./helpers";

// The 2026-10-18-0105 visitor run: #193, #198, #199, #200 (in agents.test.ts) and #201.
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
  vi.unstubAllEnvs();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;

async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-round-9-test" } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}

const line = (i: number) => ({ dialogue: `Line ${i}: so what's the strangest map you've ever drawn?`, action: "", emotion: "curious", interest_signal: 0.6 });

async function twoAgents() {
  const ctxA = await connect();
  const ctxB = await connect();
  const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctxA)).structuredContent;
  const b = (await call("create_character", validCharacter({ name: "Bo Quill", open_to_dates: true }), ctxB)).structuredContent;
  return { ctxA, ctxB, a: a.character.id as string, b: b.character.id as string };
}

describe("turn numbers say which is which (#199)", () => {
  it("turn is 0-based; turn_number counts from 1; you_are names the side", async () => {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const first = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent;
    expect(first.step).toMatchObject({ turn: 0, turn_number: 1, you_are: "a: Ada Lumen" });
    expect(first.step.instructions).toMatch(/^Turn 1 of /);
    expect(first.ending_note).toMatch(/already decided how this date ends/);
    const second = (await call("submit_own_date_step", { episode_id: first.step.episode_id, output: line(0) }, ctx)).structuredContent.step;
    expect(second).toMatchObject({ turn: 1, turn_number: 2, you_are: "b: Bo Quill" });
  });
});

describe("the recap step names the decided ending (#201)", () => {
  it("on a date between your own two characters", async () => {
    scriptOutcome({ ending: "second_date" });
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    let step = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent.step;
    let i = 0;
    while (step.stage === "turn") step = (await call("submit_own_date_step", { episode_id: step.episode_id, output: line(i++) }, ctx)).structuredContent.step;
    expect(step).toMatchObject({ stage: "recap", ending: "second_date", ending_label: expect.any(String) });
    expect(step.instructions).toMatch(/ending: second_date/);
  });
});

describe("two-agent dates: what's waiting is named, and the host is said (#198, #193)", () => {
  it("waiting_for_you names the invite, which stops counting once the invited agent plays", async () => {
    const { ctxA, ctxB, a, b } = await twoAgents();
    const started = (await call("start_own_date", { character_id: a, partner_id: b }, ctxA)).structuredContent.step;
    const id = started.episode_id;
    const before = (await call("my_characters", {}, ctxB)).structuredContent.waiting_for_you;
    expect(before).toMatchObject({ own_date_invite: 1, open_dates: [{ episode_id: id, your_character: "Bo Quill", with: "Ada Lumen", your_move: false }] });
    await call("submit_own_date_step", { episode_id: id, output: line(0) }, ctxA);
    const b1 = (await call("get_own_date_step", { episode_id: id }, ctxB)).structuredContent.step;
    expect(b1).toMatchObject({ stage: "turn", turn_number: 2 });
    await call("submit_own_date_step", { episode_id: id, output: line(1) }, ctxB);
    expect((await call("my_characters", {}, ctxB)).structuredContent.waiting_for_you?.own_date_invite).toBeUndefined();
  });

  it("the agent that played the other side hears who airs it, and my_own_dates says so", async () => {
    const { ctxA, ctxB, a, b } = await twoAgents();
    const id = (await call("start_own_date", { character_id: a, partner_id: b }, ctxA)).structuredContent.step.episode_id;
    expect((await call("my_own_dates", {}, ctxB)).structuredContent.dates[0].host).toMatchObject({ character: "Ada Lumen", you_can_air: false });
    expect((await call("my_own_dates", {}, ctxA)).structuredContent.dates[0].host).toMatchObject({ character: "Ada Lumen", you_can_air: true });
    await t.db.query(`update episodes set status = 'ready' where id = $1`, [id]);
    const refused = await call("air_date", { episode_id: id }, ctxB);
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/Only Ada Lumen's agent, which asked for this date, can air it/);
  });
});

describe("turn steps name the decided ending too (#204)", () => {
  it("every turn of a date between your own two characters says where it's headed", async () => {
    scriptOutcome({ ending: "friends" });
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const started = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent;
    expect(started.ending_note).toMatch(/every turn step and the recap step name the ending/);
    let step = started.step;
    let i = 0;
    while (step.stage === "turn") {
      expect(step).toMatchObject({ ending: "friends", ending_label: expect.any(String) });
      expect(step.instructions).toMatch(/ends as ".+" \(ending: friends\)/);
      // Outside the character's own prompt: its messages don't change.
      expect(JSON.stringify(step.messages)).not.toMatch(/ending: friends/);
      step = (await call("submit_own_date_step", { episode_id: step.episode_id, output: line(i++) }, ctx)).structuredContent.step;
    }
    expect(step).toMatchObject({ stage: "recap", ending: "friends" });
  });

  it("a two-agent date's turns don't carry it", async () => {
    scriptOutcome({ ending: "friends" });
    const { ctxA, ctxB, a, b } = await twoAgents();
    const first = (await call("start_own_date", { character_id: a, partner_id: b }, ctxA)).structuredContent.step;
    expect(first.stage).toBe("turn");
    expect(first.ending).toBeUndefined();
    expect(first.ending_label).toBeUndefined();
    expect(first.instructions).not.toMatch(/ending: friends/);
    await call("submit_own_date_step", { episode_id: first.episode_id, output: line(0) }, ctxA);
    const theirs = (await call("get_own_date_step", { episode_id: first.episode_id }, ctxB)).structuredContent.step;
    expect(theirs.stage).toBe("turn");
    expect(theirs.ending).toBeUndefined();
    expect(theirs.instructions).not.toMatch(/ending: friends/);
  });

  it("nor does a two-agent turn handed back refused (#432)", async () => {
    scriptOutcome({ ending: "friends" });
    const { ctxA, a, b } = await twoAgents();
    const id = (await call("start_own_date", { character_id: a, partner_id: b }, ctxA)).structuredContent.step.episode_id;
    for (const output of ["not a JSON object", { dialogue: "" }, "x".repeat(20_001)]) {
      const out = (await call("submit_own_date_step", { episode_id: id, output }, ctxA)).structuredContent;
      expect(out.rejected).toEqual(expect.any(String));
      expect(out.step.stage).toBe("turn");
      expect(out.step.ending).toBeUndefined();
      expect(out.step.ending_label).toBeUndefined();
      expect(out.step.instructions).not.toMatch(/ending: friends/);
    }
  });
});
