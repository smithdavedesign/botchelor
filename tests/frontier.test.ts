import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as frontierAdmin } from "@/app/api/admin/frontier/route";
import {
  frontierAuthorized,
  frontierConfigured,
  frontierModelFromEnv,
  setFrontierModelForTests,
  setModelForTests,
} from "@/lib/model";

// Built at runtime from parts, so no credential-shaped literal sits in the repo (as helpers.ts does).
const PW = ["frontier", "test", "pass"].join("-");
const FAKE_KEY = ["frontier", "test", "key"].join("-");
const FRONTIER_ENV = { FRONTIER_LLM_BASE_URL: "https://gateway.example/v1", FRONTIER_LLM_API_KEY: FAKE_KEY, FRONTIER_LLM_MODEL: "demo-model" };

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
    const env = { FRONTIER_PASSWORD: PW };
    expect(frontierAuthorized(req({ "x-frontier-key": PW }), env)).toBe(true);
    expect(frontierAuthorized(req({ "x-frontier-key": "nope" }), env)).toBe(false);
    expect(frontierAuthorized(req(), env)).toBe(false); // no header
  });

  it("is only configured when all three FRONTIER_LLM_* vars are present", () => {
    expect(frontierConfigured({})).toBe(false);
    expect(frontierModelFromEnv({})).toBeNull();
    expect(frontierConfigured(FRONTIER_ENV)).toBe(true);
    expect(frontierModelFromEnv(FRONTIER_ENV)).not.toBeNull();
  });
});

describe("POST /api/admin/frontier", () => {
  const stubFrontierEnv = () => {
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    vi.stubEnv("FRONTIER_LLM_BASE_URL", FRONTIER_ENV.FRONTIER_LLM_BASE_URL);
    vi.stubEnv("FRONTIER_LLM_API_KEY", FRONTIER_ENV.FRONTIER_LLM_API_KEY);
    vi.stubEnv("FRONTIER_LLM_MODEL", FRONTIER_ENV.FRONTIER_LLM_MODEL);
  };

  it("refuses without the password (403), so a stranger can never spend", async () => {
    stubFrontierEnv();
    expect((await frontierAdmin(req())).status).toBe(403);
    expect((await frontierAdmin(req({ "x-frontier-key": "nope" }))).status).toBe(403);
  });

  it("returns 503 when authorized but no frontier model is configured", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    expect((await frontierAdmin(req({ "x-frontier-key": PW }))).status).toBe(503);
  });

  it("runs the free and frontier models and returns both scenes when authorized", async () => {
    stubFrontierEnv();
    setModelForTests({ async complete() { return JSON.stringify({ scene: "FREE scene" }); } });
    setFrontierModelForTests({ async complete() { return JSON.stringify({ scene: "FRONTIER scene" }); } });
    const res = await frontierAdmin(req({ "x-frontier-key": PW }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ free: "FREE scene", frontier: "FRONTIER scene" });
  });
});
