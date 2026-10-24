import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as writerGet, POST as writerPost } from "@/app/api/admin/after-dark/writer/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { deleteAfterDarkData } from "@/lib/account";
import { saveAdultSettings } from "@/lib/adult/settings";
import { setWriter, writerFor, writerOptions } from "@/lib/adult/writer";
import { DEFAULT_WRITER_CONFIG, mergeWriterConfig, writerConfigOf } from "@/lib/adult/writer-config";
import { claimAdmin } from "@/lib/admins";
import { sessionCookies } from "@/lib/http";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Who writes the scenes (lib/adult/writer*.ts; David, 2026-10-24: GLM-4.6, and a person can switch). No model is called.

describe("the writers' settings", () => {
  it("default to GLM-4.6 with DeepSeek V3.1 to switch to, keep what parses, and refuse a default off the list or a repeat", () => {
    expect(DEFAULT_WRITER_CONFIG.default).toBe("z-ai/glm-4.6");
    expect(DEFAULT_WRITER_CONFIG.models.map((m) => m.id)).toEqual(["z-ai/glm-4.6", "deepseek/deepseek-chat-v3.1:nitro"]);
    expect(writerConfigOf(null)).toEqual(DEFAULT_WRITER_CONFIG);
    // A stored default that's no longer on the list falls back to the first writer.
    expect(writerConfigOf({ default: "gone/model" }).default).toBe("z-ai/glm-4.6");
    expect(mergeWriterConfig(DEFAULT_WRITER_CONFIG, { default: "deepseek/deepseek-chat-v3.1:nitro" }).default).toBe("deepseek/deepseek-chat-v3.1:nitro");
    expect(() => mergeWriterConfig(DEFAULT_WRITER_CONFIG, { default: "not/on-the-list" })).toThrow(/default/);
    expect(() => mergeWriterConfig(DEFAULT_WRITER_CONFIG, { models: [DEFAULT_WRITER_CONFIG.models[0], DEFAULT_WRITER_CONFIG.models[0]] })).toThrow(/once/);
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
});

const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];

describe("each person's writer", () => {
  it("is the default until they pick one on the list, and goes with their account", async () => {
    const me = userIdOf(newUserCookie());
    expect(await writerFor(t.db, me)).toBe("z-ai/glm-4.6");
    expect(await setWriter(t.db, me, "deepseek/deepseek-chat-v3.1:nitro")).toBe(true);
    expect(await writerFor(t.db, me)).toBe("deepseek/deepseek-chat-v3.1:nitro");
    expect(await setWriter(t.db, me, "someone/else")).toBe(false);
    // Taken off the list by an admin: they're back on the default.
    await saveAdultSettings(t.db, { writer: { models: [{ id: "z-ai/glm-4.6", label: "GLM-4.6", note: "" }] } });
    expect(await writerOptions(t.db, me)).toMatchObject({ chosen: "z-ai/glm-4.6", default: "z-ai/glm-4.6" });
    await deleteAfterDarkData(t.db, me);
    expect((await t.db.query(`select 1 from adult_prefs where user_id = $1`, [me])).rows).toHaveLength(0);
  });

  it("is picked through the API by someone After Dark is open to, and the admins set the list and the default", async () => {
    const me = userIdOf(newUserCookie());
    await claimAdmin(t.db, me);
    const cookie = signedIn(me);
    const post = (body: unknown) => writerPost(new Request(`${BASE_URL}/api/admin/after-dark/writer`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
    expect((await (await writerGet(new Request(`${BASE_URL}/api/admin/after-dark/writer`, { headers: { cookie } }))).json()).chosen).toBe("z-ai/glm-4.6");
    expect((await (await post({ model: "deepseek/deepseek-chat-v3.1:nitro" })).json()).chosen).toBe("deepseek/deepseek-chat-v3.1:nitro");
    expect((await post({ model: "nope/nope" })).status).toBe(422);
    expect((await (await post({ model: null })).json()).chosen).toBe("z-ai/glm-4.6");
    // Not open to a stranger.
    const stranger = signedIn(userIdOf(newUserCookie()));
    expect((await writerGet(new Request(`${BASE_URL}/api/admin/after-dark/writer`, { headers: { cookie: stranger } }))).status).toBe(404);
    // The settings: a default off the list is refused with why.
    const save = (body: unknown) => settingsPost(new Request(`${BASE_URL}/api/admin/after-dark/settings`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
    const bad = await save({ writer: { default: "not/listed" } });
    expect(bad.status).toBe(422);
    expect((await bad.json()).message).toMatch(/^Writer:/);
    const ok = await (await save({ writer: { default: "deepseek/deepseek-chat-v3.1:nitro" } })).json();
    expect(ok.settings.writer.default).toBe("deepseek/deepseek-chat-v3.1:nitro");
  });
});
