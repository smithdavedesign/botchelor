import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as frontierAdmin } from "@/app/api/admin/frontier/route";
import {
  frontierAuthorized,
  frontierConfigured,
  frontierModelFromEnv,
  setFrontierModelForTests,
  setModelForTests,
} from "@/lib/model";

function req(headers: Record<string, string> = {}, body: unknown = { a: "Mira", b: "Rafe", ending: "second_date" }) {
  return new Request("http://localhost/api/admin/frontier", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  setModelForTests(null);
  setFrontierModelForTests(null);
  vi.unstubAllEnvs();
});

describe("the frontier gate (unit)", () => {
  it("authorizes only when a password is set AND the header matches it", () => {
    expect(frontierAuthorized(req(), {})).toBe(false); // no password configured
    const env = { FRONTIER_PASSWORD: "s3cret" };
    expect(frontierAuthorized(req({ "x-frontier-key": "s3cret" }), env)).toBe(true);
    expect(frontierAuthorized(req({ "x-frontier-key": "wrong" }), env)).toBe(false);
    expect(frontierAuthorized(req(), env)).toBe(false); // no header
  });

  it("is only configured when all three FRONTIER_LLM_* vars are present", () => {
    expect(frontierConfigured({})).toBe(false);
    expect(frontierModelFromEnv({})).toBeNull();
    const env = { FRONTIER_LLM_BASE_URL: "https://gw/v1", FRONTIER_LLM_API_KEY: "k", FRONTIER_LLM_MODEL: "m" };
    expect(frontierConfigured(env)).toBe(true);
    expect(frontierModelFromEnv(env)).not.toBeNull();
  });
});

describe("POST /api/admin/frontier", () => {
  it("refuses without the password (403), so a stranger can never spend", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", "pw");
    vi.stubEnv("FRONTIER_LLM_BASE_URL", "https://gw/v1");
    vi.stubEnv("FRONTIER_LLM_API_KEY", "k");
    vi.stubEnv("FRONTIER_LLM_MODEL", "m");
    expect((await frontierAdmin(req())).status).toBe(403);
    expect((await frontierAdmin(req({ "x-frontier-key": "wrong" }))).status).toBe(403);
  });

  it("returns 503 when authorized but no frontier model is configured", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", "pw");
    expect((await frontierAdmin(req({ "x-frontier-key": "pw" }))).status).toBe(503);
  });

  it("runs the free and frontier models and returns both scenes when authorized", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", "pw");
    vi.stubEnv("FRONTIER_LLM_BASE_URL", "https://gw/v1");
    vi.stubEnv("FRONTIER_LLM_API_KEY", "k");
    vi.stubEnv("FRONTIER_LLM_MODEL", "m");
    setModelForTests({ async complete() { return JSON.stringify({ scene: "FREE scene" }); } });
    setFrontierModelForTests({ async complete() { return JSON.stringify({ scene: "FRONTIER scene" }); } });
    const res = await frontierAdmin(req({ "x-frontier-key": "pw" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ free: "FREE scene", frontier: "FRONTIER scene" });
  });
});
