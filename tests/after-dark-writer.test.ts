import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as scenePost } from "@/app/api/admin/after-dark/route";
import { GET as writerGet, POST as writerPost } from "@/app/api/admin/after-dark/writer/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { deleteAfterDarkData } from "@/lib/account";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { SCENE_REPLY_TOKENS } from "@/lib/adult/scenes";
import { saveAdultSettings } from "@/lib/adult/settings";
import { setWriter, writerChoice, writerFor, writerOptions } from "@/lib/adult/writer";
import { DEFAULT_WRITER_CONFIG, mergeWriterConfig, writerConfigOf, writerNote } from "@/lib/adult/writer-config";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { sessionCookies } from "@/lib/http";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Who writes the scenes (lib/adult/writer*.ts; David, 2026-10-24: GLM-4.6, and a person can switch). No model is called.

describe("the writers' settings", () => {
  // David, 2026-11-01: the quick one by default (the slow default was After Dark visitors' most-cited drag).
  it("default to DeepSeek V3.1 with GLM-4.6 to switch to, keep what parses, and refuse a default off the list or a repeat", () => {
    expect(DEFAULT_WRITER_CONFIG.default).toBe("deepseek/deepseek-chat-v3.1:nitro");
    expect(DEFAULT_WRITER_CONFIG.models.map((m) => m.id)).toEqual(["z-ai/glm-4.6", "deepseek/deepseek-chat-v3.1:nitro"]);
    expect(writerConfigOf(null)).toEqual(DEFAULT_WRITER_CONFIG);
    // A stored default that's no longer on the list falls back to the first writer.
    expect(writerConfigOf({ default: "gone/model" }).default).toBe("deepseek/deepseek-chat-v3.1:nitro");
    expect(mergeWriterConfig(DEFAULT_WRITER_CONFIG, { default: "z-ai/glm-4.6" }).default).toBe("z-ai/glm-4.6");
    expect(() => mergeWriterConfig(DEFAULT_WRITER_CONFIG, { default: "not/on-the-list" })).toThrow(/default/);
    expect(() => mergeWriterConfig(DEFAULT_WRITER_CONFIG, { models: [DEFAULT_WRITER_CONFIG.models[0], DEFAULT_WRITER_CONFIG.models[0]] })).toThrow(/once/);
  });

  it("say when a step wasn't their own writer's: the fallback, or the fast one's opening (#1053)", () => {
    const m = DEFAULT_WRITER_CONFIG.models;
    const [glm, ds] = ["z-ai/glm-4.6", "deepseek/deepseek-chat-v3.1:nitro"];
    expect(writerNote(m, { asked: glm, wrote: ds, theirs: glm })).toBe("✍️ GLM-4.6 sent nothing back: DeepSeek V3.1 wrote this one.");
    expect(writerNote(m, { asked: ds, wrote: ds, theirs: glm })).toBe("✍️ DeepSeek V3.1 wrote the opening so it starts quickly; GLM-4.6 writes from the next step.");
    expect(writerNote(m, { asked: glm, wrote: glm, theirs: glm })).toBeNull();
    expect(writerNote(m, { asked: ds, wrote: ds, theirs: ds })).toBeNull();
  });
});

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setSeasonCastForTests(null);
});

const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];

describe("each person's writer", () => {
  it("is the default until they pick one on the list, and goes with their account", async () => {
    const me = userIdOf(newUserCookie());
    expect(await writerFor(t.db, me)).toBe("deepseek/deepseek-chat-v3.1:nitro");
    expect(await setWriter(t.db, me, "z-ai/glm-4.6")).toBe(true);
    expect(await writerFor(t.db, me)).toBe("z-ai/glm-4.6");
    expect(await setWriter(t.db, me, "someone/else")).toBe(false);
    // Taken off the list by an admin: they're back on the default.
    await saveAdultSettings(t.db, { writer: { models: [{ id: "deepseek/deepseek-chat-v3.1:nitro", label: "DeepSeek V3.1", note: "" }] } });
    expect(await writerOptions(t.db, me)).toMatchObject({ chosen: "deepseek/deepseek-chat-v3.1:nitro", default: "deepseek/deepseek-chat-v3.1:nitro" });
    await deleteAfterDarkData(t.db, me);
    expect((await t.db.query(`select 1 from adult_prefs where user_id = $1`, [me])).rows).toHaveLength(0);
  });

  it("a night's first lines are the fast writer's, unless they picked one themselves (the audit, 2026-10-29)", async () => {
    // A slow default (the admins' to set) is where the fast opening matters.
    await saveAdultSettings(t.db, { writer: { default: "z-ai/glm-4.6" } });
    const me = userIdOf(newUserCookie());
    expect(await writerChoice(t.db, me, { opening: true })).toMatchObject({ id: "deepseek/deepseek-chat-v3.1:nitro", think_tokens: 0, theirs: "z-ai/glm-4.6" });
    expect((await writerChoice(t.db, me)).id).toBe("z-ai/glm-4.6");
    await setWriter(t.db, me, "z-ai/glm-4.6");
    expect((await writerChoice(t.db, me, { opening: true })).id).toBe("z-ai/glm-4.6");
  });

  it("is picked through the API by someone After Dark is open to, and the admins set the list and the default", async () => {
    const me = userIdOf(newUserCookie());
    await claimAdmin(t.db, me);
    const cookie = signedIn(me);
    const post = (body: unknown) => writerPost(new Request(`${BASE_URL}/api/admin/after-dark/writer`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
    expect((await (await writerGet(new Request(`${BASE_URL}/api/admin/after-dark/writer`, { headers: { cookie } }))).json()).chosen).toBe("deepseek/deepseek-chat-v3.1:nitro");
    expect((await (await post({ model: "z-ai/glm-4.6" })).json()).chosen).toBe("z-ai/glm-4.6");
    expect((await post({ model: "nope/nope" })).status).toBe(422);
    expect((await (await post({ model: null })).json()).chosen).toBe("deepseek/deepseek-chat-v3.1:nitro");
    // Not open to a stranger.
    const stranger = signedIn(userIdOf(newUserCookie()));
    expect((await writerGet(new Request(`${BASE_URL}/api/admin/after-dark/writer`, { headers: { cookie: stranger } }))).status).toBe(404);
    // The settings: a default off the list is refused with why.
    const save = (body: unknown) => settingsPost(new Request(`${BASE_URL}/api/admin/after-dark/settings`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
    const bad = await save({ writer: { default: "not/listed" } });
    expect(bad.status).toBe(422);
    expect((await bad.json()).message).toMatch(/^Writer:/);
    const ok = await (await save({ writer: { default: "z-ai/glm-4.6" } })).json();
    expect(ok.settings.writer.default).toBe("z-ai/glm-4.6");
  });
});

describe("a writer that thinks first", () => {
  it("gets its thinking room on top of the step's reply, so the thinking never crowds out the lines", async () => {
    expect(DEFAULT_WRITER_CONFIG.models.map((m) => [m.id, m.think_tokens])).toEqual([
      ["z-ai/glm-4.6", 1200],
      ["deepseek/deepseek-chat-v3.1:nitro", 0],
    ]);
    setAdultModelForTests(null);
    setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ lines: [{ who: "a", text: "You came." }, { who: "b", text: "I said I would." }] }) } }] });
    });
    const me = userIdOf(newUserCookie());
    await claimAdmin(t.db, me);
    // The thinking writer as the default (the admins' to set), so the opening and the next step differ.
    await saveAdultSettings(t.db, { enabled: true, openrouter_key: "sk-or-test-0000", writer: { default: "z-ai/glm-4.6" } });
    const step = () =>
      scenePost(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", cookie: signedIn(me) }, body: JSON.stringify({ a: HOUSE_CHARACTERS[0].id, b: HOUSE_CHARACTERS[1].id }) }));
    // The night's first lines are the fast writer's (writerChoice opening); the next step is the default's, with its room.
    // #1053: the opening says the fast one wrote it; the default's own step says nothing.
    const opening = await step();
    expect(opening.status).toBe(200);
    expect((await opening.json()).writer_note).toMatch(/^✍️ DeepSeek V3\.1 wrote the opening/);
    expect(sent[0]).toMatchObject({ model: "deepseek/deepseek-chat-v3.1:nitro", max_tokens: SCENE_REPLY_TOKENS });
    const before = sent.length;
    const second = await step();
    expect(second.status).toBe(200);
    expect((await second.json()).writer_note).toBeUndefined();
    expect(sent[before]).toMatchObject({ model: "z-ai/glm-4.6", max_tokens: SCENE_REPLY_TOKENS + 1200 });
    await setWriter(t.db, me, "deepseek/deepseek-chat-v3.1:nitro");
    expect((await step()).status).toBe(200);
    expect(sent.at(-1)).toMatchObject({ model: "deepseek/deepseek-chat-v3.1:nitro", max_tokens: SCENE_REPLY_TOKENS });
  });
});
