import { describe, expect, it } from "vitest";
import {
  canSeal,
  currentSealVersion,
  keySecretState,
  MIN_KEY_SECRET_LENGTH,
  needsReseal,
  openKey,
  reseal,
  sealKey,
  sealVersion,
  V2_PREFIX,
} from "@/lib/key-crypto";

// Sealing stored keys (lib/key-crypto.ts, docs/PRDs/connections.md "Security model"): v2 under KEY_ENCRYPTION_SECRET,
// legacy (M16) under SESSION_SECRET, either readable, legacy sealed again as v2 when it's read. Every secret and key here
// is built from parts at runtime and is obviously not real (GitGuardian scans every commit).

const SESSION = ["crypto", "test", "session", "words"].join("-");
const KEY_SECRET = ["crypto", "test", "key", "encryption", "words", "here"].join("-");
const OTHER_KEY_SECRET = ["crypto", "test", "other", "encryption", "words", "here"].join("-");
const PLAIN = ["test", "key", "not", "real", "crypto", "9876"].join("-");
const CONTEXT = "user:test-user:openrouter";

const legacyEnv = { SESSION_SECRET: SESSION };
const v2Env = { SESSION_SECRET: SESSION, KEY_ENCRYPTION_SECRET: KEY_SECRET };

describe("which secret seals a key", () => {
  it("is v2 with KEY_ENCRYPTION_SECRET, legacy without it, and nothing with neither", () => {
    expect(KEY_SECRET.length).toBeGreaterThanOrEqual(MIN_KEY_SECRET_LENGTH);
    expect(keySecretState(v2Env)).toBe("on");
    expect(currentSealVersion(v2Env)).toBe("v2");
    expect(keySecretState(legacyEnv)).toBe("off");
    expect(currentSealVersion(legacyEnv)).toBe("legacy");
    expect(currentSealVersion({})).toBeNull();
    expect(canSeal({})).toBe(false);
    expect(() => sealKey(PLAIN, CONTEXT, {})).toThrow(/can't be stored/);
  });

  it("ignores a KEY_ENCRYPTION_SECRET that's too short to be safe, and keeps sealing legacy", () => {
    const short = { SESSION_SECRET: SESSION, KEY_ENCRYPTION_SECRET: ["too", "short"].join("-") };
    expect(keySecretState(short)).toBe("too_short");
    expect(currentSealVersion(short)).toBe("legacy");
    expect(sealVersion(sealKey(PLAIN, CONTEXT, short))).toBe("legacy");
  });
});

describe("sealing and opening", () => {
  it("round-trips a v2 key, and the stored value is neither the key nor any part of it", () => {
    const sealed = sealKey(PLAIN, CONTEXT, v2Env);
    expect(sealed.ciphertext.startsWith(V2_PREFIX)).toBe(true);
    expect(sealVersion(sealed)).toBe("v2");
    for (const part of [PLAIN, PLAIN.slice(-4), PLAIN.slice(0, 8)]) {
      expect(sealed.ciphertext).not.toContain(part);
      expect(sealed.nonce).not.toContain(part);
    }
    expect(Buffer.from(sealed.ciphertext.slice(V2_PREFIX.length), "base64").toString("utf8")).not.toContain(PLAIN);
    expect(openKey(sealed, CONTEXT, v2Env)).toBe(PLAIN);
  });

  it("round-trips a legacy key exactly as M16 sealed it (no prefix)", () => {
    const sealed = sealKey(PLAIN, CONTEXT, legacyEnv);
    expect(sealed.ciphertext.startsWith(V2_PREFIX)).toBe(false);
    expect(sealVersion(sealed)).toBe("legacy");
    expect(openKey(sealed, CONTEXT, legacyEnv)).toBe(PLAIN);
  });

  it("seals the same key differently every time (a fresh nonce)", () => {
    const a = sealKey(PLAIN, CONTEXT, v2Env);
    const b = sealKey(PLAIN, CONTEXT, v2Env);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("opens a legacy key once KEY_ENCRYPTION_SECRET is set (the fallback), and a v2 key needs that secret", () => {
    const legacy = sealKey(PLAIN, CONTEXT, legacyEnv);
    expect(openKey(legacy, CONTEXT, v2Env)).toBe(PLAIN);
    const v2 = sealKey(PLAIN, CONTEXT, v2Env);
    expect(openKey(v2, CONTEXT, legacyEnv)).toBeNull(); // the secret was taken away: unreadable, not a crash
  });

  it("fails closed under the wrong secret, never returning garbage", () => {
    const v2 = sealKey(PLAIN, CONTEXT, v2Env);
    expect(openKey(v2, CONTEXT, { ...v2Env, KEY_ENCRYPTION_SECRET: OTHER_KEY_SECRET })).toBeNull();
    const legacy = sealKey(PLAIN, CONTEXT, legacyEnv);
    expect(openKey(legacy, CONTEXT, { SESSION_SECRET: ["another", "session", "words"].join("-") })).toBeNull();
  });

  it("binds a v2 key to where it's stored: copied onto another row, or another person, it doesn't open", () => {
    const sealed = sealKey(PLAIN, CONTEXT, v2Env);
    expect(openKey(sealed, "user:someone-else:openrouter", v2Env)).toBeNull();
    expect(openKey(sealed, "user:test-user:openai", v2Env)).toBeNull();
    expect(openKey(sealed, CONTEXT, v2Env)).toBe(PLAIN);
  });

  it("refuses a tampered ciphertext or nonce", () => {
    const sealed = sealKey(PLAIN, CONTEXT, v2Env);
    const raw = Buffer.from(sealed.ciphertext.slice(V2_PREFIX.length), "base64");
    raw[0] ^= 1;
    expect(openKey({ ...sealed, ciphertext: V2_PREFIX + raw.toString("base64") }, CONTEXT, v2Env)).toBeNull();
    expect(openKey({ ...sealed, nonce: Buffer.alloc(12, 7).toString("base64") }, CONTEXT, v2Env)).toBeNull();
    expect(openKey({ ciphertext: `${V2_PREFIX}AAAA`, nonce: sealed.nonce }, CONTEXT, v2Env)).toBeNull();
    expect(openKey({ ciphertext: "not base64 at all!", nonce: "x" }, CONTEXT, legacyEnv)).toBeNull();
  });
});

describe("moving legacy keys to v2", () => {
  it("re-encrypts a legacy key as v2, and the new seal opens without SESSION_SECRET", () => {
    const legacy = sealKey(PLAIN, CONTEXT, legacyEnv);
    expect(needsReseal(legacy, legacyEnv)).toBe(false); // nothing to move to yet
    expect(needsReseal(legacy, v2Env)).toBe(true);
    const moved = reseal(legacy, CONTEXT, v2Env)!;
    expect(moved.plain).toBe(PLAIN);
    expect(sealVersion(moved.sealed)).toBe("v2");
    expect(openKey(moved.sealed, CONTEXT, { KEY_ENCRYPTION_SECRET: KEY_SECRET })).toBe(PLAIN);
    // Rotating SESSION_SECRET no longer matters for it.
    expect(openKey(moved.sealed, CONTEXT, { SESSION_SECRET: ["rotated", "words"].join("-"), KEY_ENCRYPTION_SECRET: KEY_SECRET })).toBe(PLAIN);
  });

  it("leaves a v2 key alone, and can't move a legacy key it can't open", () => {
    expect(reseal(sealKey(PLAIN, CONTEXT, v2Env), CONTEXT, v2Env)).toBeNull();
    const legacy = sealKey(PLAIN, CONTEXT, legacyEnv);
    expect(reseal(legacy, CONTEXT, { SESSION_SECRET: ["rotated", "away"].join("-"), KEY_ENCRYPTION_SECRET: KEY_SECRET })).toBeNull();
  });
});
