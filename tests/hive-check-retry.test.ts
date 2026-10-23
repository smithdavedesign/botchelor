// The output check asks a busy Hive again instead of throwing the picture away (2026-10-23: a picture was discarded
// because one 429 meant "the check couldn't run").
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkOutput, HIVE_MODERATION, HIVE_RETRIES, HIVE_VLM, retryAfterMs, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";

const MOD_OK = { status: [{ response: { output: [{ classes: [{ class: "no_child_present", score: 0.99 }, { class: "yes_child_present", score: 0.01 }] }] } }] };
const VLM_OK = { choices: [{ message: { content: JSON.stringify({ answer: "ADULTS" }) } }] };
const IMG = { base64: "aGVsbG8=", mime: "image/png" };

type Reply = { status: number; body?: unknown; retryAfter?: string };
const reply = (r: Reply) =>
  new Response(r.body === undefined ? "busy" : JSON.stringify(r.body), { status: r.status, headers: r.retryAfter ? { "retry-after": r.retryAfter } : {} });

let waits: number[] = [];
let calls: string[] = [];
let inFlight = 0;
let maxInFlight = 0;
function script(byEndpoint: Record<string, Reply[]>) {
  setCheckFetchForTests(async (input) => {
    const url = String(input);
    const key = url.startsWith(HIVE_MODERATION) ? "mod" : url.startsWith(HIVE_VLM) ? "vlm" : url;
    calls.push(key);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    const next = byEndpoint[key]?.shift();
    if (!next) throw new Error(`no scripted reply for ${key}`);
    return reply(next);
  });
}

beforeEach(() => {
  waits = [];
  calls = [];
  inFlight = 0;
  maxInFlight = 0;
  setCheckSleepForTests(async (ms) => void waits.push(ms));
});
afterEach(() => {
  setCheckFetchForTests(null);
  setCheckSleepForTests(null);
});

describe("the output check and a busy Hive", () => {
  it("asks again after a 429 and keeps the picture when the check then passes", async () => {
    script({ mod: [{ status: 429 }, { status: 200, body: MOD_OK }], vlm: [{ status: 200, body: VLM_OK }] });
    expect(await checkOutput("k", IMG)).toEqual({ ok: true });
    expect(calls).toEqual(["mod", "mod", "vlm"]);
    expect(waits).toEqual([1500]);
  });

  it("waits as long as Retry-After asks, capped", async () => {
    script({ mod: [{ status: 429, retryAfter: "3" }, { status: 429, retryAfter: "120" }, { status: 200, body: MOD_OK }], vlm: [{ status: 200, body: VLM_OK }] });
    expect(await checkOutput("k", IMG)).toEqual({ ok: true });
    expect(waits).toEqual([3000, 8000]);
  });

  it("gives up after its retries, and a check that can't run still refuses the picture", async () => {
    script({ mod: Array.from({ length: HIVE_RETRIES + 1 }, () => ({ status: 429 })) });
    const out = await checkOutput("k", IMG);
    expect(out.ok).toBe(false);
    expect(out).toMatchObject({ reason: expect.stringContaining("couldn't run (Hive answered 429)") });
    expect(calls).toHaveLength(HIVE_RETRIES + 1);
  });

  it("retries a 5xx and a dropped connection, but fails at once on any other answer", async () => {
    script({ mod: [{ status: 503 }, { status: 200, body: MOD_OK }], vlm: [{ status: 502 }, { status: 200, body: VLM_OK }] });
    expect(await checkOutput("k", IMG)).toEqual({ ok: true });

    calls = [];
    script({ mod: [{ status: 401 }] });
    const refused = await checkOutput("k", IMG);
    expect(refused).toMatchObject({ ok: false, reason: expect.stringContaining("Hive answered 401") });
    expect(calls).toEqual(["mod"]);
  });

  it("runs the moderation and age checks one after the other, never as a burst of two", async () => {
    script({ mod: [{ status: 200, body: MOD_OK }], vlm: [{ status: 200, body: VLM_OK }] });
    expect(await checkOutput("k", IMG)).toEqual({ ok: true });
    expect(maxInFlight).toBe(1);
  });

  it("retryAfterMs: seconds or a date, capped, and nothing when unsaid", () => {
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("2")).toBe(2000);
    expect(retryAfterMs("600")).toBe(8000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 5_000)).toBe(5000);
    expect(retryAfterMs("soon")).toBeNull();
  });
});
