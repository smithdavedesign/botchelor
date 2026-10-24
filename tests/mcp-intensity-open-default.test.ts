import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { autoPicturesSettled } from "@/lib/adult/auto-pictures";
import { setCheckFetchForTests } from "@/lib/adult/check";
import { HARD_NO_IDS, INTENSITIES, plainTalk } from "@/lib/adult/limits";
import { ADULT_TOOLS, limitsArg, runAdultTool } from "@/lib/adult/mcp";
import { setMediaFetchForTests } from "@/lib/adult/media";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage, MCP_SERVER_INFO, MCP_TOOLS, type McpContext } from "@/lib/mcp";
import type { ChatMessage } from "@/lib/model";
import { partnerStyleOf, settleCommitment } from "@/lib/partners";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSetsFetchForTests } from "@/lib/sets";
import { api, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

// MCP 2.12.0 (David, 2026-10-23): the admin After Dark tools set the pair's limits (intensity and hard nos) through the
// Limits panel's own saveLimits, and new characters default to partner_style "open" (characters made before keep theirs).
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
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setSetsFetchForTests(async () => new Response("no", { status: 500 }));
});
afterEach(async () => {
  await autoPicturesSettled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setSetsFetchForTests(null);
  setMediaFetchForTests(null);
  setCheckFetchForTests(null);
});

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

it("is MCP 2.12.0 or later", () => {
  expect(MCP_SERVER_INFO.version.localeCompare("2.12.0", undefined, { numeric: true })).toBeGreaterThanOrEqual(0);
});

// ---------------------------------------------------------------------------------------------------------------------
// After Dark: the pair's limits over the admin MCP
// ---------------------------------------------------------------------------------------------------------------------

const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort();
const stored = async () => (await t.db.query<{ intensity: string | null; hard_nos: { chips: string[]; own: string[] } | null }>("select intensity, hard_nos from adult_scenes")).rows[0];

let k = 0;
const word = () => `${["ka", "lo", "mi", "nu", "pe", "ra", "si", "tu", "vo", "ze"][k % 10]}${["ban", "dor", "fel", "gim", "hux", "jor", "kel", "lum", "mox", "nib"][Math.floor(k / 10) % 10]}${["a", "e", "i", "o", "u"][Math.floor(k++ / 100) % 5]}`;
const six = () => ({ lines: Array.from({ length: 6 }, (_, i) => ({ who: i % 2 ? "b" : "a", text: `${word()} ${word()} ${word()} ${word()}.` })) });
/** The scene model: each step's reply; the recap, facts and PG notes their own. */
function scripted() {
  const prompts: ChatMessage[][] = [];
  setAdultModelForTests({
    complete: async (messages: ChatMessage[]) => {
      if (/running recap/.test(messages[0].content)) return JSON.stringify({ recap: "They talked by the lighthouse until late." });
      if (/factual memory/.test(messages[0].content)) return JSON.stringify({ a: [], b: [] });
      if (/what a private night left behind/.test(messages[0].content)) return JSON.stringify({ a: "You talked until late.", b: "You talked until late." });
      prompts.push(messages);
      return JSON.stringify(six());
    },
  } as never);
  return prompts;
}

describe("after_dark_write and after_dark_scene take the pair's intensity and hard nos", () => {
  it("documents them with the enums the Limits panel uses, and keeps the tool count", () => {
    expect(ADULT_TOOLS).toHaveLength(7);
    for (const name of ["after_dark_write", "after_dark_scene"]) {
      const props = (ADULT_TOOLS.find((x) => x.name === name)!.inputSchema as Any).properties;
      expect(props.intensity).toMatchObject({ type: "string", enum: [...INTENSITIES] });
      expect(props.hard_nos.properties.chips.items.enum).toEqual(HARD_NO_IDS);
    }
    expect(ADULT_TOOLS.find((x) => x.name === "after_dark_scene")!.annotations.readOnlyHint).toBe(false);
    // Admin only: never in the public or core tool lists.
    expect(MCP_TOOLS.some((x) => x.name.startsWith("after_dark_"))).toBe(false);
  });

  it("after_dark_scene saves every level, filthy included, and writes nothing", async () => {
    await claimAdmin(t.db, userIdOf(newUserCookie()));
    const prompts = scripted();
    expect(INTENSITIES).toEqual(["slow_burn", "flirty", "spicy", "explicit", "filthy"]);
    for (const level of INTENSITIES) {
      const r = await runAdultTool(t.db, "after_dark_scene", { a: CAST_A, b: CAST_B, intensity: level });
      expect("data" in r && (r.data.scene as { intensity: string }).intensity).toBe(level);
      expect((await stored()).intensity).toBe(level);
    }
    expect(prompts).toHaveLength(0);
    expect((await t.db.query("select 1 from adult_steps where kind = 'write'")).rows).toHaveLength(0);
    // Without limits it's a read, as before.
    const read = await runAdultTool(t.db, "after_dark_scene", { a: CAST_A, b: CAST_B });
    expect("data" in read && (read.data.scene as { intensity: string }).intensity).toBe("filthy");
  });

  it("after_dark_write saves the intensity before the step, so the step is written at it", async () => {
    await claimAdmin(t.db, userIdOf(newUserCookie()));
    const prompts = scripted();
    const r = await runAdultTool(t.db, "after_dark_write", { a: CAST_A, b: CAST_B, intensity: "filthy" });
    expect("data" in r).toBe(true);
    expect((await stored()).intensity).toBe("filthy");
    expect(prompts[0][0].content).toContain("this scene is written filthy");
    const step = (await t.db.query<{ flags: { filthy?: boolean } }>("select flags from adult_steps where kind = 'write' order by created_at desc limit 1")).rows[0];
    expect(step.flags.filthy).toBe(true);
  });

  it("a dirty_talk hard no keeps filthy written as explicit, as the panel's limits do", async () => {
    await claimAdmin(t.db, userIdOf(newUserCookie()));
    const prompts = scripted();
    const r = await runAdultTool(t.db, "after_dark_write", { a: CAST_A, b: CAST_B, intensity: "filthy", hard_nos: { chips: ["dirty_talk"] } });
    expect("data" in r).toBe(true);
    const s = await stored();
    expect(s).toMatchObject({ intensity: "filthy", hard_nos: { chips: ["dirty_talk"], own: [] } });
    expect(plainTalk({ intensity: "filthy", hard_nos: s.hard_nos! }, 4)).toBe(false);
    expect(prompts[0][0].content).not.toContain("this scene is written filthy");
    const step = (await t.db.query<{ flags: { filthy?: boolean } }>("select flags from adult_steps where kind = 'write' order by created_at desc limit 1")).rows[0];
    expect(step.flags.filthy).toBeUndefined();
  });

  it("the intensity's refusals hold: a steer past it is refused, with the new level saved", async () => {
    await claimAdmin(t.db, userIdOf(newUserCookie()));
    const prompts = scripted();
    const r = await runAdultTool(t.db, "after_dark_write", {
      a: CAST_A,
      b: CAST_B,
      intensity: "slow_burn",
      direction: 'Rafe says "I want to unbutton your shirt"',
      steer_mode: "direct",
    });
    expect("error" in r && r.error).toMatch(/past kissing/);
    expect((await stored()).intensity).toBe("slow_burn");
    expect(prompts).toHaveLength(0);
  });

  it("an unknown level or chip is an error and nothing is saved; own hard nos keep the panel's rules", async () => {
    await claimAdmin(t.db, userIdOf(newUserCookie()));
    scripted();
    expect(await runAdultTool(t.db, "after_dark_scene", { a: CAST_A, b: CAST_B, intensity: "wild" })).toMatchObject({ error: expect.stringMatching(/intensity is one of slow_burn, flirty, spicy, explicit, filthy/) });
    expect(await runAdultTool(t.db, "after_dark_write", { a: CAST_A, b: CAST_B, hard_nos: { chips: ["nope"] } })).toMatchObject({ error: expect.stringMatching(/isn't a hard no/) });
    expect((await t.db.query("select 1 from adult_scenes")).rows).toHaveLength(0);
    const tooMany = await runAdultTool(t.db, "after_dark_scene", { a: CAST_A, b: CAST_B, hard_nos: { own: Array.from({ length: 9 }, (_, i) => `tickling ${i}`) } });
    expect("error" in tooMany && tooMany.error).toMatch(/Up to 8/);
    const ok = await runAdultTool(t.db, "after_dark_scene", { a: CAST_A, b: CAST_B, hard_nos: { chips: ["biting"], own: ["tickling"] } });
    expect("data" in ok && (ok.data.scene as { hard_nos: unknown }).hard_nos).toEqual({ chips: ["biting"], own: ["tickling"] });
    expect(limitsArg({})).toEqual({ limits: null });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// partner_style: new characters are open
// ---------------------------------------------------------------------------------------------------------------------

const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;
async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "open-default-test" } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const styleRow = async (id: string) => (await t.db.query<{ partner_style: string | null }>(`select partner_style from characters where id = $1`, [id])).rows[0].partner_style;

describe("new characters default to partner_style open", () => {
  it("over MCP: create_character without partner_style makes it open, stored and echoed; one and decide still choosable", async () => {
    const ctx = await connect();
    const made = await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx);
    expect(made.isError).toBeFalsy();
    const id = made.structuredContent.character.id as string;
    expect(made.structuredContent.partner_style).toBe("open");
    expect(await styleRow(id)).toBe("open");
    // No "make it open" next call for one that already is.
    expect(JSON.stringify(made.structuredContent.next_calls ?? [])).not.toMatch(/partner_style/);
    for (const style of ["one", "decide"]) {
      const c = await call("create_character", validCharacter({ name: `Bo ${style === "one" ? "Quill" : "Marsh"}`, keep_name: true, partner_style: style }), ctx);
      expect(await styleRow(c.structuredContent.character.id)).toBe(style);
    }
  });

  it("on the web: a character made in the /create wizard (POST /api/characters) is open", async () => {
    const owner = newUserCookie();
    const res = await api.createCharacter(validCharacter({ name: "Cass Vega", open_to_dates: true }), owner);
    expect(res.status).toBe(201);
    const c = await res.json();
    expect(await styleRow(c.id)).toBe("open");
    expect(await partnerStyleOf(t.db, c.id)).toMatchObject({ choice: "open", effective: "open", taken: false });
  });

  it("an existing decide character stays decide", async () => {
    const owner = newUserCookie();
    const c = await (await api.createCharacter(validCharacter({ name: "Dex Marlow" }), owner)).json();
    expect((await api.editCharacter(c.id, { partner_style: "decide" }, owner)).status).toBe(200);
    expect((await api.editCharacter(c.id, { bio: "Still here, still deciding, still drawing maps of places that don't exist." }, owner)).status).toBe(200);
    expect(await styleRow(c.id)).toBe("decide");
    expect((await partnerStyleOf(t.db, c.id))?.choice).toBe("decide");
  });

  it("a stored null keeps its old meaning: decide, settled from its temperament, and taken when that's one", async () => {
    const ownerA = newUserCookie();
    const a = await (await api.createCharacter(validCharacter({ name: "Una Pike", open_to_dates: true }), ownerA)).json();
    const b = await (await api.createCharacter(validCharacter({ name: "Ira Fenn", open_to_dates: true }), newUserCookie())).json();
    // As every character made before 2.12.0 was stored.
    await t.db.query(`update characters set partner_style = null where id = $1`, [a.id]);
    expect(await partnerStyleOf(t.db, a.id)).toMatchObject({ choice: "decide", decided: null, effective: null, taken: false });
    const [lo, hi] = [a.id, b.id].sort();
    await t.db.query(`insert into relationships (character_a, character_b, dates, second_dates, stage) values ($1, $2, 3, 2, 'dating')`, [lo, hi]);
    await settleCommitment(t.db, lo, hi);
    const style = await partnerStyleOf(t.db, a.id);
    expect(style?.choice).toBe("decide");
    expect(style?.decided).toMatch(/^(one|open)$/);
    expect(style?.effective).toBe(style?.decided);
    expect(style?.taken).toBe(style?.decided === "one");
    expect(await styleRow(a.id)).toBeNull();
    // The new default (b, open) never settles or closes.
    expect(await partnerStyleOf(t.db, b.id)).toMatchObject({ choice: "open", decided: null, taken: false });
  });
});
