import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as postBeacon } from "@/app/api/e/route";
import { POST as postMcp } from "@/app/api/mcp/route";
import { POST as postSync } from "@/app/api/watch-parties/[id]/sync/route";
import { crisisAware } from "@/lib/crisis";
import { ApiError, DEFAULT_MAX_BODY_BYTES, handle, json, MAX_BODY_BYTES, readBodyText, readForm, readJson, readJsonOr } from "@/lib/http";
import { BASE_URL, startTestDb } from "./helpers";

// 2026-11-22 audit: request bodies were read whole and measured after, and a body with no Content-Length (chunked) was
// read however big it was. Now every reader stops at its cap as the body streams in.

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

/**
 * A body that never ends, 16 KB a pull, counting what was taken from it: a reader that read it all would never return.
 * It makes nothing until asked (highWaterMark 0), so what it counts is what was read.
 */
function endless(chunk = 16 * 1024) {
  const seen = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        seen.pulled += chunk;
        controller.enqueue(new Uint8Array(chunk).fill(32));
      },
      cancel() {
        seen.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, seen };
}

/** A chunked request (no Content-Length), as a client streaming its body sends it. */
const chunked = (path: string, body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
  new Request(BASE_URL + path, { method: "POST", body, duplex: "half", headers: { "content-type": "application/json", ...headers } } as RequestInit);

const status = async (p: Promise<unknown>) => p.then(() => 0, (e: unknown) => (e instanceof ApiError ? e.status : -1));

describe("the capped readers", () => {
  it("refuse a declared length over the cap before reading a byte", async () => {
    const { stream, seen } = endless();
    const req = chunked("/x", stream, { "content-length": String(MAX_BODY_BYTES + 1) });
    expect(await status(readJson(req))).toBe(413);
    expect(seen.pulled).toBe(0);
  });

  it("stop a chunked body where it crosses the cap, and let go of it", async () => {
    const { stream, seen } = endless();
    expect(await status(readBodyText(chunked("/x", stream), 64 * 1024))).toBe(413);
    expect(seen.pulled).toBeLessThanOrEqual(64 * 1024 + 2 * 16 * 1024);
    expect(seen.cancelled).toBe(true);
  });

  it("read what fits as before: JSON, loose JSON, forms with files", async () => {
    const small = new Request(`${BASE_URL}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: "é" }) });
    expect(await readJson(small)).toEqual({ a: "é" });
    expect(await status(readJson(new Request(`${BASE_URL}/x`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" })))).toBe(415);
    expect(await readJsonOr(new Request(`${BASE_URL}/x`, { method: "POST", body: "not json" }), 1024, { fallback: true })).toEqual({ fallback: true });
    const form = new FormData();
    form.set("action", "approve");
    form.set("file", new Blob([new Uint8Array([0, 255, 1, 254])]), "f.bin");
    const read = await readForm(new Request(`${BASE_URL}/x`, { method: "POST", body: form }), 4096);
    expect(read.get("action")).toBe("approve");
    expect([...new Uint8Array(await (read.get("file") as Blob).arrayBuffer())]).toEqual([0, 255, 1, 254]);
    const big = new FormData();
    big.set("file", new Blob([new Uint8Array(8192)]), "big.bin");
    expect(await status(readForm(new Request(`${BASE_URL}/x`, { method: "POST", body: big }), 4096))).toBe(413);
  });
});

describe("handle()", () => {
  it("refuses a body declared over its cap before the handler runs, and a route can ask for more", async () => {
    let ran = 0;
    const route = handle(async () => {
      ran++;
      return json({ ok: true });
    });
    const over = await route(chunked("/x", endless().stream, { "content-length": String(DEFAULT_MAX_BODY_BYTES + 1) }));
    expect(over.status).toBe(413);
    expect((await over.json()).error).toBe("body_too_large");
    expect(over.headers.get("set-cookie")).toBeNull();
    expect(ran).toBe(0);
    const roomy = handle(async () => json({ ok: true }), { maxBodyBytes: DEFAULT_MAX_BODY_BYTES * 4 });
    const fits = new Request(`${BASE_URL}/x`, { method: "POST", headers: { "content-length": String(DEFAULT_MAX_BODY_BYTES + 1) }, body: "x".repeat(DEFAULT_MAX_BODY_BYTES + 1) });
    expect((await roomy(fits)).status).toBe(200);
  });

  it("hands the handler the very request that came in (in-process bookings are marked on the object)", async () => {
    let seen: Request | null = null;
    const route = handle(async (req: Request) => {
      seen = req;
      return json({ ok: true });
    });
    const req = new Request(`${BASE_URL}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    await route(req);
    expect(seen).toBe(req);
  });

  it("turns a reader's 413 mid-stream into the answer", async () => {
    const route = handle(async (req: Request) => json({ got: await readJson(req) }));
    const res = await route(chunked("/x", endless().stream));
    expect(res.status).toBe(413);
  });
});

describe("crisisAware", () => {
  it("reads its copy no further than the handler would, and answers 413 without running the handler", async () => {
    let ran = 0;
    const route = crisisAware(
      "date_note",
      (b) => [typeof b.note === "string" ? b.note : undefined],
      handle(async (req: Request) => {
        ran++;
        return json({ got: await readJson(req) });
      }),
    );
    const { stream, seen } = endless();
    const res = await route(chunked("/x", stream));
    expect(res.status).toBe(413);
    expect(ran).toBe(0);
    expect(seen.pulled).toBeLessThanOrEqual(MAX_BODY_BYTES + 2 * 16 * 1024);
    expect(seen.cancelled).toBe(true);
    // A body that fits still reaches the handler whole.
    const ok = await route(new Request(`${BASE_URL}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: "hello" }) }));
    expect(await ok.json()).toEqual({ got: { note: "hello" } });
  });
});

describe("routes that read their own bodies", () => {
  it("the watch-party heartbeat, the MCP endpoint and the beacon stop at their caps", async () => {
    const sync = await postSync(chunked("/api/watch-parties/x/sync", endless().stream), { params: Promise.resolve({ id: "x" }) });
    expect(sync.status).toBe(413);
    const mcp = await postMcp(chunked("/api/mcp", endless().stream));
    expect(mcp.status).toBe(413);
    expect((await mcp.json()).error.message).toBe("request too large");
    // The beacon answers 204 whatever it's sent, and reads no more than a beacon can be.
    const { stream, seen } = endless();
    expect((await postBeacon(chunked("/api/e", stream, { "content-type": "text/plain" }))).status).toBe(204);
    expect(seen.pulled).toBeLessThanOrEqual(64 * 1024);
  });

  it("nothing in app/ or lib/ reads a request body past the capped readers", () => {
    const root = join(__dirname, "..");
    const files = ["app", "lib"].flatMap((dir) =>
      readdirSync(join(root, dir), { recursive: true, encoding: "utf8" })
        .filter((f) => /\.tsx?$/.test(f))
        .map((f) => join(dir, f)),
    );
    const raw = /\b(req|request)\.(json|text|formData|arrayBuffer|blob)\(\)|\breq\.clone\(\)\.(json|text)\(/;
    const offenders = files.filter((f) => f !== join("lib", "http.ts") && raw.test(readFileSync(join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
