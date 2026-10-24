import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { pauseHive } from "@/lib/adult/hive-limit";
import { checkMedia, mediaGate, setModerationFetchForTests, SIGHTENGINE_CHECK, VENICE_CHAT } from "@/lib/adult/moderation";
import { DEFAULT_MODERATION, mergeModerationConfig, moderationConfigOf } from "@/lib/adult/moderation-config";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { startTestDb } from "./helpers";

// Which checker checks (lib/adult/moderation.ts; David, 2026-10-24: "Hive is a bottleneck, add an alternative … everything
// configurable"). Hive, Venice, Sightengine and the endpoint are all stubbed: no live calls.

describe("the checks' settings", () => {
  it("default to Hive as before, keep what parses, and refuse a bad value", () => {
    expect(DEFAULT_MODERATION).toMatchObject({ mode: "hive", alts: ["venice_vlm"], min_sources: 1, pg_via: "hive", vlm_model: "qwen3-vl-235b-a22b", admin_checker: "same" });
    expect(moderationConfigOf({ mode: "both", min_sources: 9 })).toMatchObject({ mode: "both", min_sources: 1 });
    expect(mergeModerationConfig(DEFAULT_MODERATION, { mode: "hive_then_alt" }).mode).toBe("hive_then_alt");
    expect(() => mergeModerationConfig(DEFAULT_MODERATION, { endpoint_url: "http://plain" })).toThrow();
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
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  setCheckSleepForTests(async () => {});
  await saveAdultSettings(t.db, { venice_key: "placeholder-venice", hive_key: "placeholder-hive" });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setCheckFetchForTests(null);
  setCheckSleepForTests(null);
  setModerationFetchForTests(null);
});

const PIC = { base64: Buffer.from([137, 80, 78, 71]).toString("base64"), mime: "image/png" };
const answer = (a: string) => ({ choices: [{ message: { role: "assistant", content: JSON.stringify({ answer: a }) } }] });
const MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.4 }] }] };
/** Hive, answering (or 429 every time). */
function hive(opts: { age?: string; down?: boolean } = {}) {
  const calls: string[] = [];
  setCheckFetchForTests(async (input: RequestInfo | URL) => {
    calls.push(String(input) === HIVE_VLM ? "vlm" : "moderation");
    if (opts.down) return new Response(JSON.stringify({ message: "Too Many Requests" }), { status: 429 });
    return Response.json(String(input) === HIVE_VLM ? answer(opts.age ?? "ADULTS") : MOD);
  });
  return calls;
}
/** The alternatives: Venice's chat, Sightengine, the endpoint. */
function alts(opts: { venice?: string | number; sightengine?: unknown; endpoint?: string } = {}) {
  const calls: { url: string; body: unknown }[] = [];
  setModerationFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body });
    if (url === VENICE_CHAT) return typeof opts.venice === "number" ? new Response("no", { status: opts.venice }) : Response.json(answer(opts.venice ?? "ADULTS"));
    if (url.startsWith(SIGHTENGINE_CHECK)) return Response.json(opts.sightengine ?? { status: "success", faces: [{ attributes: { age: { minor: 0.02 } } }], artificial_faces: [] });
    return Response.json({ answer: opts.endpoint ?? "ADULTS" });
  });
  return calls;
}

describe("checkMedia", () => {
  it("in hive mode is Hive alone, as before", async () => {
    const h = hive();
    const a = alts();
    expect(await checkMedia(t.db, PIC, "image")).toMatchObject({ ok: true, nsfw: 0.4 });
    expect(h).toEqual(["moderation", "vlm"]);
    expect(a).toHaveLength(0);
  });

  it("in hive_then_alt asks the Venice vision model only when Hive gives no verdict, and keeps Hive's own refusals", async () => {
    await saveAdultSettings(t.db, { moderation: { mode: "hive_then_alt" } });
    hive({ age: "MINOR" });
    const a = alts();
    expect(await checkMedia(t.db, PIC, "image")).toMatchObject({ ok: false, reason: "age check: MINOR" });
    expect(a).toHaveLength(0);
    // Hive paused: the vision model checks, with the age question held to three answers.
    await pauseHive(t.db, "test");
    hive();
    expect(await checkMedia(t.db, PIC, "image")).toMatchObject({ ok: true, via: ["venice_vlm"] });
    const sent = a[0].body as { model: string; response_format: { json_schema: { name: string } }; messages: { content: { type: string }[] }[] };
    expect(sent.model).toBe("qwen3-vl-235b-a22b");
    expect(sent.response_format.json_schema.name).toBe("age_check");
    expect(sent.messages[0].content.map((c) => c.type)).toEqual(["text", "image_url"]);
    alts({ venice: "UNSURE" });
    expect(await checkMedia(t.db, PIC, "keyframe")).toMatchObject({ ok: false, reason: "age check (Venice): UNSURE" });
    // A video waits for Hive.
    expect((await checkMedia(t.db, PIC, "video")).ok).toBe(false);
  });

  it("in both mode needs Hive and every alternative to pass", async () => {
    await saveAdultSettings(t.db, { moderation: { mode: "both" } });
    hive();
    alts({ venice: "MINOR" });
    expect(await checkMedia(t.db, PIC, "image")).toMatchObject({ ok: false, reason: "age check (Venice): MINOR" });
    alts();
    expect(await checkMedia(t.db, PIC, "image")).toMatchObject({ ok: true, via: ["hive", "venice_vlm"] });
  });

  it("in alt mode never asks Hive; Sightengine's minor score and its unaged faces; the endpoint; min_sources", async () => {
    await saveAdultSettings(t.db, { moderation: { mode: "alt", alts: ["sightengine"], sightengine_user: "u1" }, sightengine_key: "placeholder-secret" });
    const h = hive();
    alts();
    expect(await checkMedia(t.db, PIC, "image")).toMatchObject({ ok: true, via: ["sightengine"] });
    alts({ sightengine: { status: "success", faces: [{ attributes: { age: { minor: 0.6 } } }] } });
    expect(await checkMedia(t.db, PIC, "image")).toMatchObject({ ok: false, reason: "age check (Sightengine): minor 0.60" });
    alts({ sightengine: { status: "success", faces: [], artificial_faces: [{}] } });
    expect((await checkMedia(t.db, PIC, "image")).ok).toBe(false);
    expect(h).toHaveLength(0);
    // Two checkers, both needed: one that can't run is no verdict.
    await saveAdultSettings(t.db, { moderation: { alts: ["venice_vlm", "endpoint"], endpoint_url: "https://age.example/check", min_sources: 2 } });
    alts({ venice: 500 });
    expect(await checkMedia(t.db, PIC, "image")).toMatchObject({ ok: false, reason: expect.stringMatching(/^the check couldn't run/) });
    alts();
    expect(await checkMedia(t.db, PIC, "image")).toMatchObject({ ok: true, via: ["venice_vlm", "endpoint"] });
  });

  it("sends the show's own pictures to the alternatives with the show's question when pg_via is alt", async () => {
    await saveAdultSettings(t.db, { moderation: { pg_via: "alt" } });
    const h = hive();
    const a = alts({ venice: "SAFE" });
    expect(await checkMedia(t.db, PIC, "set")).toMatchObject({ ok: true });
    expect((a[0].body as { response_format: { json_schema: { name: string } } }).response_format.json_schema.name).toBe("pg_check");
    alts({ venice: "UNSAFE" });
    expect((await checkMedia(t.db, PIC, "pg_image")).ok).toBe(false);
    expect(h).toHaveLength(0);
  });
});

describe("mediaGate", () => {
  it("lets a picture through while Hive is paused only when an alternative can stand in; never a video", async () => {
    await pauseHive(t.db, "test");
    expect((await mediaGate(t.db)).ok).toBe(false);
    await saveAdultSettings(t.db, { moderation: { mode: "hive_then_alt" } });
    expect((await mediaGate(t.db)).ok).toBe(true);
    expect((await mediaGate(t.db, { video: true })).ok).toBe(false);
    await saveAdultSettings(t.db, { venice_key: "" });
    expect((await mediaGate(t.db)).ok).toBe(false);
  });
});

describe("an admin's own pictures (David, 2026-10-24: Hive off for admins)", () => {
  it("are checked by the Venice vision model, not Hive, still refused when it says so; everyone else's and videos stay Hive's", async () => {
    await claimAdmin(t.db, "admin-1");
    await saveAdultSettings(t.db, { moderation: { admin_checker: "alt" } });
    const h = hive();
    const a = alts();
    expect(await checkMedia(t.db, PIC, "image", { owner: "admin-1" })).toMatchObject({ ok: true, via: ["venice_vlm"] });
    expect(await checkMedia(t.db, PIC, "keyframe", { owner: "admin-1" })).toMatchObject({ ok: true });
    expect(h).toHaveLength(0);
    expect(a.filter((c) => c.url === VENICE_CHAT)).toHaveLength(2);
    // Never kept unchecked: the vision model's refusal stands.
    alts({ venice: "MINOR" });
    expect((await checkMedia(t.db, PIC, "image", { owner: "admin-1" })).ok).toBe(false);
    // Someone else's, and a video, go to Hive.
    alts();
    expect(await checkMedia(t.db, PIC, "image", { owner: "someone" })).toMatchObject({ ok: true, nsfw: 0.4 });
    await checkMedia(t.db, { base64: PIC.base64, mime: "video/mp4" }, "video", { owner: "admin-1" });
    expect(h.length).toBeGreaterThan(0);
  });

  it("draw while Hive is paused, unless set back to the same as everyone's", async () => {
    await claimAdmin(t.db, "admin-1");
    await saveAdultSettings(t.db, { moderation: { admin_checker: "alt" } });
    await pauseHive(t.db, "test: Hive out for the day");
    expect((await mediaGate(t.db, { owner: "admin-1" })).ok).toBe(true);
    expect((await mediaGate(t.db, { owner: "someone" })).ok).toBe(false);
    expect((await mediaGate(t.db, { owner: "admin-1", video: true })).ok).toBe(false);
    await saveAdultSettings(t.db, { moderation: { admin_checker: "same" } });
    expect((await mediaGate(t.db, { owner: "admin-1" })).ok).toBe(false);
    hive();
    alts();
    expect(await checkMedia(t.db, PIC, "image", { owner: "admin-1" })).not.toMatchObject({ via: ["venice_vlm"] });
  });
});
