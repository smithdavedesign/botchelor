// The output check asks a busy Hive again instead of throwing the picture away (2026-10-23: a picture was discarded
// because one 429 meant "the check couldn't run").
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkOutput, HIVE_MODERATION, HIVE_RETRIES, HIVE_VLM, probeHive, retryAfterHeaderMs, retryAfterMs, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";

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
    expect(out).toMatchObject({ reason: "the check couldn't run (Hive answered 429: busy)", unavailable: { status: 429, retry_after_ms: null } });
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

// What Hive said (lib/adult/check.ts hiveSaid, 2026-10-23): its own words go in the error, adult_rejections and the log.
describe("Hive's reply in the error", () => {
  const KEY = "placeholder-hive-secret-1234";
  const raw = (status: number, body: string, headers: Record<string, string> = {}) => new Response(body, { status, headers });
  function always(res: () => Response | Promise<Response>) {
    setCheckFetchForTests(async () => res());
  }

  it("keeps Hive's message from a JSON body, and counts a 429 as Hive not answering", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    always(() => raw(429, JSON.stringify({ status_code: 429, message: "Too Many Requests" })));
    const out = await checkOutput(KEY, IMG);
    expect(out).toEqual({ ok: false, reason: "the check couldn't run (Hive answered 429: Too Many Requests)", unavailable: { status: 429, retry_after_ms: null } });
    expect(warn).toHaveBeenCalledWith("[after-dark] the Hive check couldn't run: Hive answered 429: Too Many Requests");
    // The key is only ever in the request header: never in the reason or the log.
    expect(JSON.stringify(out)).not.toContain(KEY);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY);
    warn.mockRestore();
  });

  it("keeps a text body as it came, on one line, cut to about 200 characters; Retry-After uncapped for the breaker", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    always(() => raw(429, "quota exceeded\n for this plan", { "retry-after": "900" }));
    expect(await checkOutput(KEY, IMG)).toMatchObject({ reason: "the check couldn't run (Hive answered 429: quota exceeded for this plan)", unavailable: { status: 429, retry_after_ms: 900_000 } });
    always(() => raw(503, "x".repeat(500)));
    const long = await checkOutput(KEY, IMG);
    const said = (long as { reason: string }).reason.replace("the check couldn't run (Hive answered 503: ", "").replace(/\)$/, "");
    expect(said).toHaveLength(200);
    expect(said.endsWith("…")).toBe(true);
    expect(long).toMatchObject({ unavailable: { status: 503 } });
    vi.restoreAllMocks();
  });

  it("an unreachable Hive counts as not answering (no status); a refused key doesn't", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setCheckFetchForTests(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await checkOutput(KEY, IMG)).toEqual({ ok: false, reason: "the check couldn't run (Hive couldn't be reached (fetch failed))", unavailable: { status: null, retry_after_ms: null } });
    always(() => raw(401, JSON.stringify({ error: "invalid key" })));
    expect(await checkOutput(KEY, IMG)).toEqual({ ok: false, reason: "the check couldn't run (Hive answered 401: invalid key)" });
    vi.restoreAllMocks();
  });

  it("the probe says the same: down with Hive's words and Retry-After, ok, or unknown", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    always(() => raw(429, JSON.stringify({ message: "Too Many Requests" }), { "retry-after": "120" }));
    expect(await probeHive(KEY)).toEqual({ result: "down", status: 429, retry_after_ms: 120_000, error: "Hive answered 429: Too Many Requests" });
    always(() => raw(502, ""));
    expect(await probeHive(KEY)).toEqual({ result: "down", status: 502, retry_after_ms: null, error: "Hive answered 502" });
    always(() => raw(200, "{}"));
    expect(await probeHive(KEY)).toEqual({ result: "ok" });
    always(() => raw(403, "forbidden"));
    expect(await probeHive(KEY)).toEqual({ result: "unknown", status: 403, error: "Hive answered 403: forbidden" });
    expect(retryAfterHeaderMs("7200")).toBe(7_200_000);
    vi.restoreAllMocks();
  });
});
