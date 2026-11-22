// The e2e and demo harness (scripts/harness.mjs): a local build or app sees only what a process needs from the shell
// and the stand-ins the harness names, never a key the shell happens to hold (2026-11-22 audit: it passed every
// variable but a few named ones).
import { describe, expect, it } from "vitest";
import { appEnv, shellEnv } from "../scripts/harness.mjs";

describe("the harness's app environment", () => {
  const shell = {
    PATH: "/usr/bin",
    HOME: "/home/me",
    TMPDIR: "/tmp/me",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    NODE_OPTIONS: "--max-old-space-size=2048",
    REPLICATE_API_TOKEN: "r8_not-a-real-token",
    RESEND_API_KEY: "re_not-a-real-key",
    MEDIA_BUNNY_KEY: "not-a-real-key",
    DATABASE_URL: "postgres://somewhere/real",
    NEXT_PUBLIC_SOMETHING: "baked into pages",
    SOME_SWITCH: "1",
  };

  it("keeps what a process needs to run and drops everything else", () => {
    expect(shellEnv(shell)).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/me",
      TMPDIR: "/tmp/me",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      NODE_OPTIONS: "--max-old-space-size=2048",
    });
  });

  it("passes another variable only when HARNESS_PASS_ENV names it", () => {
    const env = shellEnv({ ...shell, HARNESS_PASS_ENV: "SOME_SWITCH, MEDIA_BUNNY_KEY" });
    expect(env.SOME_SWITCH).toBe("1");
    expect(env.MEDIA_BUNNY_KEY).toBe("not-a-real-key");
    expect(env.REPLICATE_API_TOKEN).toBeUndefined();
    expect(env.HARNESS_PASS_ENV).toBeUndefined();
  });

  it("starts the app with the stand-ins, and none of this shell's keys", () => {
    const before = { ...process.env };
    Object.assign(process.env, { REPLICATE_API_TOKEN: "r8_not-a-real-token", RESEND_API_KEY: "re_not-a-real-key", DATABASE_URL: "postgres://somewhere/real" });
    try {
      const env = appEnv(4321, "/tmp/harness-db");
      expect(env.REPLICATE_API_TOKEN).toBeUndefined();
      expect(env.RESEND_API_KEY).toBeUndefined();
      expect(env.DATABASE_URL).toBeUndefined();
      expect(env).toMatchObject({ NODE_ENV: "production", PGLITE_DIR: "/tmp/harness-db", LLM_BASE_URL: "http://127.0.0.1:4321/v1", LEGACY_BARE_UID: "1" });
      expect(env.PATH).toBe(process.env.PATH);
    } finally {
      for (const k of ["REPLICATE_API_TOKEN", "RESEND_API_KEY", "DATABASE_URL"]) if (!(k in before)) delete process.env[k];
      Object.assign(process.env, before);
    }
  });
});
