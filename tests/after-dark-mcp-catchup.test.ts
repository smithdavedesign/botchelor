import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { autoPicturesSettled } from "@/lib/adult/auto-pictures";
import { setCheckFetchForTests } from "@/lib/adult/check";
import { ADULT_TOOLS, runAdultTool } from "@/lib/adult/mcp";
import { setMediaFetchForTests } from "@/lib/adult/media";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { getAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSetsFetchForTests } from "@/lib/sets";
import { newUserCookie, startTestDb, userIdOf } from "./helpers";

// MCP 2.15.0 (2026-10-29): the admin After Dark tools catch up with the page: the scene picker (after_dark_set_scene),
// the director (whisper, redo, rewind on after_dark_write), scene pictures (after_dark_picture) and every setting but keys.
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
const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort();
const pair = { a: CAST_A, b: CAST_B };

let k = 0;
const word = () => `${["ka", "lo", "mi", "nu", "pe", "ra", "si", "tu", "vo", "ze"][k % 10]}${["ban", "dor", "fel", "gim", "hux", "jor", "kel", "lum", "mox", "nib"][Math.floor(k / 10) % 10]}${["a", "e", "i", "o", "u"][Math.floor(k++ / 100) % 5]}`;
const six = () => ({ lines: Array.from({ length: 6 }, (_, i) => ({ who: i % 2 ? "b" : "a", text: `${word()} ${word()} ${word()} ${word()}.` })) });
function scripted() {
  const prompts: ChatMessage[][] = [];
  setAdultModelForTests({
    complete: async (messages: ChatMessage[]) => {
      if (/running recap/.test(messages[0].content)) return JSON.stringify({ recap: "They talked until late." });
      if (/factual memory/.test(messages[0].content)) return JSON.stringify({ a: [], b: [] });
      if (/what a private night left behind/.test(messages[0].content)) return JSON.stringify({ a: "You talked.", b: "You talked." });
      prompts.push(messages);
      return JSON.stringify(six());
    },
  } as never);
  return prompts;
}
const lineCount = async () => (await runAdultTool(t.db, "after_dark_scene", pair) as Any).data.scene.lines.length as number;

describe("the new tools are listed for the admin", () => {
  it("documents set_scene and picture, and the director on write", () => {
    const names = ADULT_TOOLS.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["after_dark_set_scene", "after_dark_picture"]));
    const write = (ADULT_TOOLS.find((x) => x.name === "after_dark_write")!.inputSchema as Any).properties;
    expect(Object.keys(write)).toEqual(expect.arrayContaining(["whisper", "forget_whisper", "redo", "rewind"]));
    const settings = (ADULT_TOOLS.find((x) => x.name === "after_dark_settings")!.inputSchema as Any).properties;
    expect(Object.keys(settings)).toEqual(expect.arrayContaining(["draw_ahead", "writer", "studio", "caps", "chapter_tokens"]));
    expect(Object.keys(settings).some((x) => x.endsWith("_key"))).toBe(false);
  });
});

describe("after_dark_set_scene", () => {
  it("takes them somewhere and sets a roleplay, then starts over", async () => {
    await claimAdmin(t.db, userIdOf(newUserCookie()));
    scripted();
    const r = (await runAdultTool(t.db, "after_dark_set_scene", { ...pair, place: "a rooftop garden", roleplay: { id: "rivals" } })) as Any;
    expect(r.error).toBeUndefined();
    expect(r.data.scene.set_place).toBe("a rooftop garden");
    expect(JSON.stringify(r.data.scene)).toContain("rivals");
    await runAdultTool(t.db, "after_dark_write", pair);
    expect(await lineCount()).toBeGreaterThan(0);
    const fresh = (await runAdultTool(t.db, "after_dark_set_scene", { ...pair, reset: true })) as Any;
    expect(fresh.data.scene.lines).toHaveLength(0);
    expect(fresh.data.nights.length).toBeGreaterThan(0);
  });

  it("refuses what the page refuses", async () => {
    await claimAdmin(t.db, userIdOf(newUserCookie()));
    expect(await runAdultTool(t.db, "after_dark_set_scene", { ...pair, roleplay: { id: "nope" } })).toEqual({ error: expect.stringMatching(/^roleplay is/) });
    expect(await runAdultTool(t.db, "after_dark_set_scene", { ...pair, scenario: "nope" })).toEqual({ error: expect.stringMatching(/^scenario is one of/) });
    expect(await runAdultTool(t.db, "after_dark_set_scene", { ...pair, scenario: "elevator", place: "a bar" })).toEqual({ error: expect.stringMatching(/own place/) });
    expect(await runAdultTool(t.db, "after_dark_set_scene", { ...pair, framing: "nope" })).toEqual({ error: expect.stringMatching(/^framing is/) });
    expect(await runAdultTool(t.db, "after_dark_set_scene", { a: CAST_A, b: "nobody" })).toEqual({ error: expect.stringMatching(/^Pick two/) });
  });

  it("starts a night from a scenario, its first lines written", async () => {
    await claimAdmin(t.db, userIdOf(newUserCookie()));
    scripted();
    const r = (await runAdultTool(t.db, "after_dark_set_scene", { ...pair, scenario: "elevator" })) as Any;
    expect(r.error).toBeUndefined();
    expect(r.data.added).toBeGreaterThan(0);
  });
});

describe("the director on after_dark_write", () => {
  it("whispers to one of them, forgets it, redoes and rewinds a step", async () => {
    await claimAdmin(t.db, userIdOf(newUserCookie()));
    const prompts = scripted();
    await runAdultTool(t.db, "after_dark_write", pair);
    const w = (await runAdultTool(t.db, "after_dark_write", { ...pair, whisper: { to: "a", text: "tell them about the lighthouse" } })) as Any;
    expect(w.error).toBeUndefined();
    expect(prompts.at(-1)!.map((m) => m.content).join("\n")).toContain("lighthouse");
    const forgot = (await runAdultTool(t.db, "after_dark_write", { ...pair, forget_whisper: "a" })) as Any;
    expect(JSON.stringify(forgot.data.scene.whispers ?? {})).not.toContain("lighthouse");
    const before = await lineCount();
    const redo = (await runAdultTool(t.db, "after_dark_write", { ...pair, redo: true })) as Any;
    expect(redo.error).toBeUndefined();
    expect(await lineCount()).toBe(before);
    const back = (await runAdultTool(t.db, "after_dark_write", { ...pair, rewind: true })) as Any;
    expect(back.data.rewound).toBeGreaterThan(0);
    expect(await lineCount()).toBeLessThan(before);
  });

  it("checks a whisper as the page does", async () => {
    await claimAdmin(t.db, userIdOf(newUserCookie()));
    expect(await runAdultTool(t.db, "after_dark_write", { ...pair, whisper: { to: "c", text: "hi" } })).toEqual({ error: expect.stringMatching(/^whisper is/) });
    expect(await runAdultTool(t.db, "after_dark_write", { ...pair, whisper: { to: "a", text: "" } })).toEqual({ error: expect.stringMatching(/^whisper is/) });
  });
});

describe("after_dark_picture", () => {
  it("says what to send, and refuses while beat pictures can't be drawn", async () => {
    await claimAdmin(t.db, userIdOf(newUserCookie()));
    scripted();
    await runAdultTool(t.db, "after_dark_write", pair);
    expect(await runAdultTool(t.db, "after_dark_picture", pair)).toEqual({ error: expect.stringMatching(/^Send line/) });
    expect(await runAdultTool(t.db, "after_dark_picture", { ...pair, line: 2 })).toEqual({ error: expect.stringMatching(/picture keys/) });
    expect(await runAdultTool(t.db, "after_dark_picture", { ...pair, picture_id: "nope" })).toEqual({ error: expect.any(String) });
  });
});

describe("after_dark_settings takes the page's settings, never its keys", () => {
  it("saves the newer ones and refuses keys and bad values", async () => {
    await claimAdmin(t.db, userIdOf(newUserCookie()));
    const r = (await runAdultTool(t.db, "after_dark_settings", { draw_ahead: true, chapter_tokens: 3, place_sounds: false })) as Any;
    expect(r.error).toBeUndefined();
    expect(await getAdultSettings(t.db)).toMatchObject({ draw_ahead: true, chapter_tokens: 3, place_sounds: false });
    expect(await runAdultTool(t.db, "after_dark_settings", { venice_key: "plain words" })).toEqual({ error: expect.stringMatching(/^Keys are set only/) });
    expect(await runAdultTool(t.db, "after_dark_settings", { chapter_tokens: 1000 })).toEqual({ error: expect.stringMatching(/^Not saved: chapter_tokens/) });
    // A blank model id leaves it as it was, as before.
    const model = (await getAdultSettings(t.db)).text_model;
    await runAdultTool(t.db, "after_dark_settings", { text_model: "  " });
    expect((await getAdultSettings(t.db)).text_model).toBe(model);
  });
});
